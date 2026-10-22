import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import {
  lastWhatsapp,
  opsApprovalOf,
  order,
  round,
  roundOf,
  supplierApprovalOf,
  supplierOrderOf,
  SUP_DRY,
  toFormed,
} from './helpers/scenarios';

const WEEK = '2026-W45';

let app: TestApp;
let cmRound: string;
let cmOrder: string;
let eggRound: string;
let eggOrder: string;

beforeEach(async () => {
  app = await createTestApp({ seed: 'demo' });
  await toFormed(app);
  cmRound = (await roundOf('CM', WEEK)).id;
  cmOrder = (await supplierOrderOf(cmRound)).id;
  eggRound = (await roundOf('EGG_A', WEEK)).id;
  eggOrder = (await supplierOrderOf(eggRound)).id;
});

afterEach(async () => {
  await app.close();
});

describe('Supplier rejection text', () => {
  it('fits a long reason into the WhatsApp text and keeps it whole in the body', async () => {
    await (
      await app.as('nadia')
    ).post(`/api/approvals/${await opsApprovalOf(eggOrder)}/approve`, {});
    const reason = 'x'.repeat(400);
    const res = await (
      await app.as('lim')
    ).post(`/api/approvals/${await supplierApprovalOf(eggOrder)}/reject`, { reason });
    expect(res.status).toBe(200);
    expect((await round(eggRound)).status).toBe('cancelled');
    const text = await lastWhatsapp('nadia', 'ops.supplier_rejected');
    expect(text!.length).toBeLessThanOrEqual(300);
    expect(text).toContain('…');
    const row = await app.prisma.notification.findFirstOrThrow({
      where: { type: 'ops.supplier_rejected' },
    });
    expect(row.body).toContain(reason);
  });

  it('does not end in two full stops', async () => {
    await (
      await app.as('nadia')
    ).post(`/api/approvals/${await opsApprovalOf(eggOrder)}/approve`, {});
    await (
      await app.as('lim')
    ).post(`/api/approvals/${await supplierApprovalOf(eggOrder)}/reject`, {
      reason: 'out of stock..',
    });
    expect(await lastWhatsapp('nadia', 'ops.supplier_rejected')).toBe(
      'Ladang Telur Contoh rejected the Grade A eggs order: out of stock.',
    );
  });
});

describe('Orders before Ops approval', () => {
  it('are hidden from the supplier but not from Ops', async () => {
    const nadia = await app.as('nadia');
    await nadia.post(`/api/approvals/${await opsApprovalOf(eggOrder)}/approve`, {});
    await nadia.post(`/api/approvals/${await opsApprovalOf(cmOrder)}/reject`, { reason: 'no' });
    const farid = await app.as('farid');
    const statuses = async (query = '') =>
      (
        (await farid.get(`/api/suppliers/${SUP_DRY}/orders${query}`)).body.items as {
          status: string;
        }[]
      ).map((o) => o.status);
    expect(await statuses()).not.toContain('rejected_by_ops');
    expect(await statuses()).not.toContain('awaiting_ops');
    expect(await statuses('?status=rejected_by_ops')).toEqual([]);
    const ops = await nadia.get(`/api/suppliers/${SUP_DRY}/orders`);
    expect(ops.body.items.map((o: { supplierOrderId: string }) => o.supplierOrderId)).toContain(
      cmOrder,
    );
    expect((await order(cmOrder)).status).toBe('rejected_by_ops');
  });

  it('are hidden while awaiting Ops', async () => {
    const farid = await app.as('farid');
    expect((await farid.get(`/api/suppliers/${SUP_DRY}/orders`)).body.items).toEqual([]);
    const ops = await (await app.as('nadia')).get(`/api/suppliers/${SUP_DRY}/orders`);
    expect(ops.body.items.length).toBeGreaterThan(0);
  });
});

describe('Approval links', () => {
  it('open the subject screen', async () => {
    const nadia = await app.as('nadia');
    const opsView = (await nadia.get('/api/approvals')).body.items.find(
      (a: { subjectId: string }) => a.subjectId === cmOrder,
    );
    expect(opsView.link).toBe('/ops');
    await nadia.post(`/api/approvals/${await opsApprovalOf(cmOrder)}/approve`, {});
    const mine = (await (await app.as('farid')).get('/api/approvals')).body.items.find(
      (a: { subjectId: string }) => a.subjectId === cmOrder,
    );
    expect(mine.link).toBe(`/supplier/orders/${cmOrder}`);
    const note = await app.prisma.notification.findFirstOrThrow({
      where: { type: 'supplier.new_order' },
    });
    expect(note.link).toBe(`/supplier/orders/${cmOrder}`);
  });
});
