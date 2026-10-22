/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are arbitrary JSON; tests assert on them */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { seedId } from '../../prisma/seed/ids';
import { appendLog } from '@/server/modules/activity/log';
import { createApproval, registerApprovalHandler } from '@/server/modules/approvals/approvals';
import { notify } from '@/server/modules/notifications/notify';
import { personCaller, systemCaller } from '@/server/platform/caller';
import { AppError } from '@/server/platform/errors';
import {
  requireOps,
  requireRole,
  requireShopAccess,
  requireSupplierAccess,
} from '@/server/platform/permissions';
import { withTransaction } from '@/server/platform/tx';
import { createTestApp, type TestApp } from './helpers/app';
import { expectNoMoneyFields } from './helpers/scans';
import { session } from './helpers/sessions';

let app: TestApp;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

const KEDAI = seedId('shop', 'KEDAI_KOPI');
const GERAI = seedId('shop', 'GERAI');
const SUP_DRY = seedId('supplier', 'SUP_DRY');
const SUP_OTHER = seedId('supplier', 'SUP_EGG');
const sys = systemCaller('test');
const ahSeng = personCaller(session('ahSeng', 'owner', { shopId: KEDAI }, 'shop'));
const rahim = personCaller(session('rahim', 'staff', { shopId: KEDAI }, 'shop'));
const farid = personCaller(session('farid', 'supplier', { supplierId: SUP_DRY }, 'supplier'));
const nadia = personCaller(
  session('nadia', 'ops', { operatorId: seedId('operator', 'OPS') }, 'operator'),
);

const statusOf = (fn: () => void): number | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof AppError ? e.status : -1;
  }
};

describe('permission helpers', () => {
  it('hides another shop from owners, staff and suppliers, and lets Ops and the system in', () => {
    expect(statusOf(() => requireShopAccess(ahSeng, KEDAI))).toBeNull();
    expect(statusOf(() => requireShopAccess(ahSeng, GERAI))).toBe(404);
    expect(statusOf(() => requireShopAccess(rahim, GERAI))).toBe(404);
    expect(statusOf(() => requireShopAccess(farid, KEDAI))).toBe(404);
    expect(statusOf(() => requireShopAccess(nadia, GERAI))).toBeNull();
    expect(statusOf(() => requireShopAccess(sys, GERAI, ['owner']))).toBeNull();
  });

  it('answers 403 when the role is not in the list for the caller own shop', () => {
    expect(statusOf(() => requireShopAccess(rahim, KEDAI, ['owner']))).toBe(403);
    expect(statusOf(() => requireShopAccess(ahSeng, KEDAI, ['owner']))).toBeNull();
  });

  it('lets a supplier reach only itself, Ops anyone, and refuses shop roles', () => {
    expect(statusOf(() => requireSupplierAccess(farid, SUP_DRY))).toBeNull();
    expect(statusOf(() => requireSupplierAccess(farid, SUP_OTHER))).toBe(404);
    expect(statusOf(() => requireSupplierAccess(nadia, SUP_OTHER))).toBeNull();
    expect(statusOf(() => requireSupplierAccess(ahSeng, SUP_DRY))).toBe(403);
    expect(statusOf(() => requireSupplierAccess(sys, SUP_DRY))).toBeNull();
  });

  it('requires Ops and requires a listed role', () => {
    expect(statusOf(() => requireOps(nadia))).toBeNull();
    expect(statusOf(() => requireOps(ahSeng))).toBe(403);
    expect(statusOf(() => requireOps(sys))).toBeNull();
    expect(statusOf(() => requireRole(farid, ['owner', 'staff']))).toBe(403);
    expect(statusOf(() => requireRole(farid, ['supplier']))).toBeNull();
  });
});

describe('activity routes', () => {
  it('lets only Ops verify the log', async () => {
    expect((await (await app.as('ahSeng')).post('/api/activity/verify')).status).toBe(403);
    expect((await (await app.as('nadia')).post('/api/activity/verify')).body).toMatchObject({
      valid: true,
    });
  });

  it('records the verification in the log', async () => {
    const before = await app.prisma.activityLogEntry.count({ where: { action: 'log.verified' } });
    const res = await (await app.as('nadia')).post('/api/activity/verify');
    const entries = await app.prisma.activityLogEntry.findMany({
      where: { action: 'log.verified' },
      orderBy: { seq: 'desc' },
    });
    expect(entries).toHaveLength(before + 1);
    expect(entries[0]).toMatchObject({
      subjectType: 'activity_log',
      subjectId: 'chain',
      operatorScope: true,
      after: res.body,
    });
  });

  it('shows staff only their own log entries, with no money fields', async () => {
    await withTransaction(app.deps, rahim, (ctx) =>
      appendLog(ctx, {
        action: 'log.verified',
        subjectType: 'shop',
        subjectId: KEDAI,
        scope: { shopId: KEDAI },
        after: { note: 'counted', totalSen: 12345, priceSen: 99 },
      }),
    );
    await withTransaction(app.deps, ahSeng, (ctx) =>
      appendLog(ctx, {
        action: 'log.verified',
        subjectType: 'shop',
        subjectId: KEDAI,
        scope: { shopId: KEDAI },
      }),
    );
    const res = await (await app.as('rahim')).get('/api/activity');
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.every((i: any) => i.actorName === 'Rahim')).toBe(true);
    expect(res.body.items.some((i: any) => i.after?.note === 'counted')).toBe(true);
    expectNoMoneyFields(res.body);
  });

  it('returns a timeline for one subject only', async () => {
    for (const subjectId of [KEDAI, KEDAI, GERAI]) {
      await withTransaction(app.deps, ahSeng, (ctx) =>
        appendLog(ctx, {
          action: 'log.verified',
          subjectType: 'shop',
          subjectId,
          scope: { shopId: KEDAI },
        }),
      );
    }
    const all = await (await app.as('ahSeng')).get('/api/activity?limit=100');
    expect(new Set(all.body.items.map((i: any) => i.subjectId)).size).toBeGreaterThan(1);

    const res = await (
      await app.as('ahSeng')
    ).get(`/api/activity?subjectType=shop&subjectId=${KEDAI}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(2);
    expect(
      res.body.items.every((i: any) => i.subjectType === 'shop' && i.subjectId === KEDAI),
    ).toBe(true);
  });

  it('needs a signed-in person', async () => {
    expect((await app.anonymous().get('/api/activity')).status).toBe(401);
  });
});

describe('notification routes', () => {
  const send = (shopId: string, n: number) =>
    withTransaction(app.deps, sys, async (ctx) => {
      for (let i = 0; i < n; i++) {
        await notify(ctx, {
          type: 'test.note',
          audience: { shopId, roles: ['owner'] },
          link: '/home',
          message: () => ({ title: `Note ${i}`, body: 'A note', whatsappText: 'A note' }),
        });
      }
    });

  it('pages notifications', async () => {
    await app.prisma.notification.deleteMany({ where: { userId: seedId('user', 'ahSeng') } });
    await send(KEDAI, 25);
    const c = await app.as('ahSeng');
    const first = await c.get('/api/notifications');
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(20);
    expect(first.body.nextCursor).not.toBeNull();
    const second = await c.get(`/api/notifications?cursor=${first.body.nextCursor}`);
    expect(second.body.items).toHaveLength(5);
    expect(second.body.nextCursor).toBeNull();
  });

  it('answers 404 for a notification id that is not a UUID', async () => {
    const c = await app.as('ahSeng');
    expect((await c.post('/api/notifications/abc/read')).status).toBe(404);
  });

  it('gives an empty page for a cursor that is not a UUID', async () => {
    const c = await app.as('ahSeng');
    const res = await c.get('/api/notifications?cursor=abc');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });

  it('marks your own notification read and hides other people notifications', async () => {
    await send(GERAI, 1);
    const sitiRow = await app.prisma.notification.findFirstOrThrow({
      where: { userId: seedId('user', 'siti') },
    });
    const c = await app.as('ahSeng');
    const own = (await c.get('/api/notifications')).body.items[0];
    expect((await c.post(`/api/notifications/${own.id}/read`)).status).toBe(200);
    const after = (await c.get('/api/notifications?limit=100')).body.items.find(
      (i: any) => i.id === own.id,
    );
    expect(after.readAt).not.toBeNull();
    expect((await c.post(`/api/notifications/${sitiRow.id}/read`)).status).toBe(404);
  });
});

describe('approval routes', () => {
  const handler = { onApprove: vi.fn(async () => {}), onReject: vi.fn(async () => {}) };
  const make = () =>
    withTransaction(app.deps, sys, async (ctx) => {
      registerApprovalHandler('supplier_order', handler);
      return (
        await createApproval(ctx, {
          type: 'supplier_order',
          subjectType: 'supplier_order',
          subjectId: 'so-shell',
          shopId: KEDAI,
          assigneeRole: 'ops',
          summary: 'Condensed milk',
          whyNeeded: 'Round formed',
          evidence: { units: 105 },
        })
      ).id;
    });

  it('lists pending approvals and lets Ops approve one', async () => {
    const id = await make();
    const c = await app.as('nadia');
    const list = await c.get('/api/approvals?status=pending');
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: any) => i.id)).toContain(id);
    const res = await c.post(`/api/approvals/${id}/approve`, { note: 'ok' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, status: 'approved' });
    expect(handler.onApprove).toHaveBeenCalled();
    const again = await c.get('/api/approvals');
    expect(again.body.items.map((i: any) => i.id)).not.toContain(id);
  });

  it('approves with no body at all', async () => {
    const id = await make();
    const res = await (await app.as('nadia')).post(`/api/approvals/${id}/approve`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, status: 'approved' });
  });

  it('answers 400 for a malformed approve body', async () => {
    const id = await make();
    const res = await (await app.as('nadia')).post(`/api/approvals/${id}/approve`, 'not json');
    expect(res.status).toBe(400);
  });

  it('answers 422 when rejecting without a reason, and rejects with one', async () => {
    const id = await make();
    const c = await app.as('nadia');
    const bad = await c.post(`/api/approvals/${id}/reject`, {});
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('REASON_REQUIRED');
    const ok = await c.post(`/api/approvals/${id}/reject`, { reason: 'Price changed' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'rejected' });
  });

  it('keeps staff out of the list and owners from deciding', async () => {
    const id = await make();
    expect((await (await app.as('rahim')).get('/api/approvals')).status).toBe(403);
    expect((await (await app.as('ahSeng')).post(`/api/approvals/${id}/approve`, {})).status).toBe(
      403,
    );
  });
});
