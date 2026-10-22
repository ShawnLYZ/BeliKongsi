import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Role } from '@/generated/prisma/client';
import { seedReferenceData } from '../../prisma/seed';
import { seedId } from '../../prisma/seed/ids';
import {
  createApproval,
  decideApproval,
  listPendingApprovals,
  registerApprovalHandler,
} from '@/server/modules/approvals/approvals';
import { emitEvent, listEvents } from '@/server/modules/integration/events';
import { notify, whatsappShareUrl } from '@/server/modules/notifications/notify';
import { defineTemplates } from '@/server/modules/notifications/templates';
import { listNotifications, markNotificationRead } from '@/server/modules/notifications/query';
import { personCaller, systemCaller } from '@/server/platform/caller';
import { withTransaction } from '@/server/platform/tx';
import { createTestDeps } from './helpers/app';
import { session } from './helpers/sessions';

const sys = systemCaller('test');
const KEDAI = seedId('shop', 'KEDAI_KOPI');
const GERAI = seedId('shop', 'GERAI');
const SUP_DRY = seedId('supplier', 'SUP_DRY');
const ahSeng = personCaller(session('ahSeng', 'owner', { shopId: KEDAI }, 'shop'));
const rahim = personCaller(session('rahim', 'staff', { shopId: KEDAI }, 'shop'));
const siti = personCaller(session('siti', 'owner', { shopId: GERAI }, 'shop'));
const farid = personCaller(session('farid', 'supplier', { supplierId: SUP_DRY }, 'supplier'));
const nadia = personCaller(
  session('nadia', 'ops', { operatorId: seedId('operator', 'OPS') }, 'operator'),
);

let t: Awaited<ReturnType<typeof createTestDeps>>;
beforeEach(async () => {
  t = await createTestDeps();
  await withTransaction(t.deps, sys, (ctx) =>
    seedReferenceData(ctx, { anchorMonday: new Date('2026-11-01T22:05:00Z') }),
  );
});
afterEach(async () => {
  await t.close();
});

const send = (input: Partial<Parameters<typeof notify>[1]> = {}) =>
  withTransaction(t.deps, sys, (ctx) =>
    notify(ctx, {
      type: 'test.note',
      audience: { shopId: KEDAI, roles: ['owner'] },
      link: '/home',
      message: () => ({ title: 'Hello', body: 'A note', whatsappText: 'A note' }),
      ...input,
    }),
  );

describe('notifications', () => {
  it('notifies only the roles asked for', async () => {
    expect(await send()).toBe(1);
    const rows = await t.deps.prisma.notification.findMany();
    expect(rows.map((r) => r.userId)).toEqual([seedId('user', 'ahSeng')]);
    expect(rows[0]).toMatchObject({ role: 'owner', shopId: KEDAI, link: '/home' });
  });

  it('refuses staff text with amounts and writes nothing', async () => {
    await expect(
      send({
        audience: { shopId: KEDAI, roles: ['owner', 'staff'] },
        message: (role) => ({
          title: 't',
          body: role === 'staff' ? 'RM 5.00' : 'ok',
          whatsappText: 'w',
        }),
      }),
    ).rejects.toThrow(/amount/);
    expect(await t.deps.prisma.notification.count()).toBe(0);
  });

  it('refuses WhatsApp text over 300 characters', async () => {
    await expect(
      send({ message: () => ({ title: 't', body: 'b', whatsappText: 'x'.repeat(301) }) }),
    ).rejects.toThrow(/300/);
  });

  it('lets a template keep its own data type and be called type-safely', () => {
    const templates = defineTemplates({
      'round.closed': (data: { productName: string }) => (_role: Role) => ({
        title: 'Round closed',
        body: data.productName,
        whatsappText: data.productName,
      }),
    });
    expect(templates['round.closed']({ productName: 'Beras' })('owner').body).toBe('Beras');
  });

  it('builds a share link with no phone number', () => {
    expect(whatsappShareUrl('Pickup code 482 913')).toBe(
      'https://wa.me/?text=Pickup%20code%20482%20913',
    );
  });

  it('sends a deduplicated notification once', async () => {
    expect(await send({ dedupeKey: 'basket-ready:w45' })).toBe(1);
    expect(await send({ dedupeKey: 'basket-ready:w45' })).toBe(0);
    expect(await t.deps.prisma.notification.count()).toBe(1);
  });

  it('reaches supplier and operator audiences', async () => {
    expect(await send({ audience: { supplierId: SUP_DRY, roles: ['supplier'] } })).toBe(1);
    expect(await send({ audience: { operator: true, roles: ['ops'] } })).toBeGreaterThanOrEqual(1);
  });

  it('lists only what the active membership may see, newest first, and marks read', async () => {
    await send({ message: () => ({ title: 'first', body: 'b', whatsappText: 'w' }) });
    t.clock.advance(60_000);
    await send({ message: () => ({ title: 'second', body: 'b', whatsappText: 'w' }) });
    await send({ audience: { shopId: KEDAI, roles: ['staff'] } });
    await send({ audience: { shopId: GERAI, roles: ['owner'] } });

    const all = { cursor: null, limit: 20 };
    const mine = await listNotifications(t.deps, ahSeng, all);
    expect(mine.items.map((i) => i.title)).toEqual(['second', 'first']);
    const first = await listNotifications(t.deps, ahSeng, { cursor: null, limit: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).not.toBeNull();
    const next = await listNotifications(t.deps, ahSeng, { cursor: first.nextCursor, limit: 1 });
    expect(next.items[0]!.title).toBe('first');

    expect((await listNotifications(t.deps, rahim, all)).items).toHaveLength(1);
    const sitis = await listNotifications(t.deps, siti, all);
    expect(sitis.items).toHaveLength(1);

    // Another shop's notification is invisible, so reading it is a 404.
    await expect(markNotificationRead(t.deps, ahSeng, sitis.items[0]!.id)).rejects.toMatchObject({
      status: 404,
    });
    const id = mine.items[0]!.id;
    await markNotificationRead(t.deps, ahSeng, id);
    await markNotificationRead(t.deps, ahSeng, id);
    const after = await listNotifications(t.deps, ahSeng, all);
    expect(after.items.find((i) => i.id === id)!.readAt).not.toBeNull();
  });
});

describe('approvals', () => {
  const handler = () => ({
    onApprove: vi.fn(async () => {}),
    onReject: vi.fn(async () => {}),
  });
  const makeApproval = (over: Partial<Parameters<typeof createApproval>[1]> = {}, caller = sys) =>
    withTransaction(t.deps, caller, async (ctx) => {
      const r = await createApproval(ctx, {
        type: 'supplier_order',
        subjectType: 'supplier_order',
        subjectId: 'so1',
        shopId: KEDAI,
        assigneeRole: 'ops',
        amountSen: 1533000,
        summary: 'Condensed milk',
        whyNeeded: 'Round formed',
        evidence: { units: 105 },
        ...over,
      });
      return r.id;
    });
  const decide = (caller: typeof nadia, id: string, input: Parameters<typeof decideApproval>[3]) =>
    decideApproval(t.deps, caller, id, input).catch((e: unknown) => e);

  it('needs a reason to reject', async () => {
    const h = handler();
    registerApprovalHandler('supplier_order', h);
    const id = await makeApproval();
    expect(await decide(nadia, id, { decision: 'reject', reason: '  ' })).toMatchObject({
      status: 422,
      code: 'REASON_REQUIRED',
    });
    expect(h.onReject).not.toHaveBeenCalled();
  });

  it('lets only the assignee role decide', async () => {
    const h = handler();
    registerApprovalHandler('supplier_order', h);
    const id = await makeApproval();
    expect(await decide(ahSeng, id, { decision: 'approve' })).toMatchObject({ status: 403 });
    expect(h.onApprove).not.toHaveBeenCalled();
    const view = await decide(nadia, id, { decision: 'approve' });
    expect(view).toMatchObject({
      status: 'approved',
      link: `/approvals/${id}`,
      amountSen: 1533000,
    });
    expect(h.onApprove).toHaveBeenCalledTimes(1);
    const row = await t.deps.prisma.approvalRequest.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'approved', decidedByUserId: seedId('user', 'nadia') });
    expect(row.decidedAt).toEqual(t.clock.now());
  });

  it('records the rejection reason and calls the reject handler', async () => {
    const h = handler();
    registerApprovalHandler('supplier_order', h);
    const id = await makeApproval();
    expect(await decide(nadia, id, { decision: 'reject', reason: 'Out of stock' })).toMatchObject({
      status: 'rejected',
    });
    expect(h.onReject).toHaveBeenCalledTimes(1);
    expect((await t.deps.prisma.approvalRequest.findUniqueOrThrow({ where: { id } })).reason).toBe(
      'Out of stock',
    );
  });

  it('answers 404 for a request the caller cannot see', async () => {
    registerApprovalHandler('supplier_order', handler());
    const id = await makeApproval();
    expect(await decide(siti, id, { decision: 'approve' })).toMatchObject({ status: 404 });
    expect(await decide(rahim, id, { decision: 'approve' })).toMatchObject({ status: 404 });
    expect(await decide(farid, id, { decision: 'approve' })).toMatchObject({ status: 404 });
  });

  it('answers 409 for a request already decided', async () => {
    const h = handler();
    registerApprovalHandler('supplier_order', h);
    const id = await makeApproval();
    await decide(nadia, id, { decision: 'approve' });
    expect(await decide(nadia, id, { decision: 'approve' })).toMatchObject({ status: 409 });
    expect(h.onApprove).toHaveBeenCalledTimes(1);
  });

  it('rolls the decision back when the handler fails', async () => {
    registerApprovalHandler('supplier_order', {
      onApprove: async () => {
        throw new Error('boom');
      },
      onReject: async () => {},
    });
    const id = await makeApproval();
    await expect(decideApproval(t.deps, nadia, id, { decision: 'approve' })).rejects.toThrow(
      'boom',
    );
    expect((await t.deps.prisma.approvalRequest.findUniqueOrThrow({ where: { id } })).status).toBe(
      'pending',
    );
  });

  it('lists pending requests per role and names the proposer', async () => {
    const opsId = await makeApproval({}, ahSeng);
    await makeApproval({ type: 'weekly_basket', assigneeRole: 'owner' });
    await makeApproval({
      type: 'supplier_confirmation',
      assigneeRole: 'supplier',
      shopId: undefined,
      supplierId: SUP_DRY,
    });
    const ops = await listPendingApprovals(t.deps, nadia);
    expect(ops.map((a) => a.id)).toEqual([opsId]);
    const proposer = await t.deps.prisma.user.findUniqueOrThrow({
      where: { id: seedId('user', 'ahSeng') },
    });
    expect(ops[0]!.proposedBy).toEqual({ type: 'person', name: proposer.displayName });
    expect((await listPendingApprovals(t.deps, ahSeng)).map((a) => a.type)).toEqual([
      'weekly_basket',
    ]);
    expect((await listPendingApprovals(t.deps, farid)).map((a) => a.type)).toEqual([
      'supplier_confirmation',
    ]);
    expect(await listPendingApprovals(t.deps, rahim)).toEqual([]);
    expect(await listPendingApprovals(t.deps, siti)).toEqual([]);
  });
});

describe('integration events', () => {
  it('refuses event data that carries a name', async () => {
    await expect(
      withTransaction(t.deps, sys, (ctx) =>
        emitEvent(ctx, 'round.closed', { roundId: 'r', shop: { name: 'x' } }),
      ),
    ).rejects.toThrow(/name/);
    await expect(
      withTransaction(t.deps, sys, (ctx) =>
        emitEvent(ctx, 'round.closed', { shops: [{ contactEmail: 'x' }] }),
      ),
    ).rejects.toThrow(/contactEmail/);
    expect(await t.deps.prisma.integrationEvent.count()).toBe(0);
  });

  it('stores an event with version 1 and lists the latest for Ops only', async () => {
    await withTransaction(t.deps, sys, async (ctx) => {
      await emitEvent(ctx, 'round.opened', { roundId: 'r1' });
      await emitEvent(ctx, 'round.closed', { roundId: 'r1', outcome: 'formed' });
    });
    const events = await listEvents(t.deps, nadia);
    expect(events.map((e) => e.type)).toEqual(['round.closed', 'round.opened']);
    expect(events[0]).toMatchObject({ version: 1, data: { roundId: 'r1', outcome: 'formed' } });
    await expect(listEvents(t.deps, ahSeng)).rejects.toMatchObject({ status: 403 });
  });
});
