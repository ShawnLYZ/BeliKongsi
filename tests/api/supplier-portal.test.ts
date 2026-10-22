import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers/app';
import {
  allShopIds,
  allShopNames,
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
import { expectNoShopIdentity } from './helpers/scans';

const WEEK = '2026-W45';

let app: TestApp;
let cmRound: string;
let cmOrder: string;
let eggAOrder: string;

beforeAll(async () => {
  app = await createTestApp({ seed: 'demo' });
  await toFormed(app);
  cmRound = (await roundOf('CM', WEEK)).id;
  cmOrder = (await supplierOrderOf(cmRound)).id;
  eggAOrder = (await supplierOrderOf((await roundOf('EGG_A', WEEK)).id)).id;
  const n = await app.as('nadia');
  await n.post(`/api/approvals/${await opsApprovalOf(cmOrder)}/approve`, {});
  await n.post(`/api/approvals/${await opsApprovalOf(eggAOrder)}/approve`, {});
});

afterAll(async () => {
  await app.close();
});

describe('The supplier portal', () => {
  it('shows the supplier one consolidated order with no shop data (stories 103, 104, 145)', async () => {
    const res = await (
      await app.as('farid')
    ).get(`/api/suppliers/${SUP_DRY}/orders?status=awaiting_supplier`);
    expect(res.body.items[0]).toMatchObject({
      productName: 'Sweetened condensed milk 390 g',
      quantity: 105,
      unitPriceSen: 14600,
      totalSen: 1533000,
      hubName: 'Klang Valley hub',
      requiredDispatchDate: '2026-11-07',
    });
    expectNoShopIdentity(res.body, await allShopNames(), await allShopIds());
  });

  it('needs a sensible dispatch date to confirm (story 105)', async () => {
    const f = await app.as('farid');
    const id = await supplierApprovalOf(cmOrder);
    expect(
      (await f.post(`/api/approvals/${id}/approve`, { expectedDispatchDate: '2026-11-01' })).status,
    ).toBe(400);
    expect(
      (await f.post(`/api/approvals/${id}/approve`, { expectedDispatchDate: '7 Nov' })).status,
    ).toBe(400);
    expect((await f.post(`/api/approvals/${id}/approve`, {})).status).toBe(400);
    expect(await order(cmOrder)).toMatchObject({ status: 'awaiting_supplier' });
    expect((await round(cmRound)).status).toBe('ordered');
    await f.post(`/api/approvals/${id}/approve`, { expectedDispatchDate: '2026-11-07' });
    expect(await order(cmOrder)).toMatchObject({
      status: 'confirmed',
      expectedDispatchDate: '2026-11-07',
    });
    expect((await round(cmRound)).status).toBe('confirmed');
  });

  it('needs a reason when a supplier rejects', async () => {
    const res = await (
      await app.as('lim')
    ).post(`/api/approvals/${await supplierApprovalOf(eggAOrder)}/reject`, {});
    expect(res.status).toBe(422);
    expect(await order(eggAOrder)).toMatchObject({ status: 'awaiting_supplier' });
  });

  it('tells Ops when a supplier rejects (story 106)', async () => {
    await (
      await app.as('lim')
    ).post(`/api/approvals/${await supplierApprovalOf(eggAOrder)}/reject`, {
      reason: 'out of stock',
    });
    expect(await order(eggAOrder)).toMatchObject({ status: 'rejected_by_supplier' });
    expect(await lastWhatsapp('nadia', 'ops.supplier_rejected')).toBe(
      'Ladang Telur Contoh rejected the Grade A eggs order: out of stock.',
    );
    expect(await lastWhatsapp('ahSeng', 'owner.order_rejected', 'Grade A eggs')).toMatch(
      /^The supplier couldn't fill Grade A eggs this week\. Full refund: RM [\d,.]+\.$/,
    );
  });

  it("hides another supplier's order", async () => {
    const l = await app.as('lim');
    expect((await l.post(`/api/supplier-orders/${cmOrder}/dispatched`)).status).toBe(404);
    expect((await l.get(`/api/suppliers/${SUP_DRY}/orders`)).status).toBe(404);
    expect((await order(cmOrder)).status).toBe('confirmed');
  });

  it('marks the order dispatched (story 107)', async () => {
    const f = await app.as('farid');
    const res = await f.post(`/api/supplier-orders/${cmOrder}/dispatched`);
    expect(res.status).toBe(200);
    expect(await order(cmOrder)).toMatchObject({ status: 'dispatched' });
    expect((await order(cmOrder)).dispatchedAt).not.toBeNull();
    expect((await round(cmRound)).status).toBe('dispatched');
    expect((await f.post(`/api/supplier-orders/${cmOrder}/dispatched`)).status).toBe(409);
  });

  it('refuses to dispatch an order that was not confirmed', async () => {
    expect(
      (await (await app.as('lim')).post(`/api/supplier-orders/${eggAOrder}/dispatched`)).status,
    ).toBe(409);
  });

  it('shows open round totals and shop counts only (story 110)', async () => {
    const res = await (await app.as('farid')).get(`/api/suppliers/${SUP_DRY}/rounds?status=open`);
    expect(res.status).toBe(200);
    expectNoShopIdentity(res.body, await allShopNames(), await allShopIds());
    expect(
      res.body.items.every((r: { shopCount: unknown }) => typeof r.shopCount === 'number'),
    ).toBe(true);
  });

  it('lists the supplier’s products and tiers read-only (story 109)', async () => {
    const res = await (await app.as('farid')).get(`/api/suppliers/${SUP_DRY}/products`);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(6);
    const cm = res.body.items.find(
      (p: { name: string }) => p.name === 'Sweetened condensed milk 390 g',
    );
    expect(cm.tiers.length).toBeGreaterThan(0);
    expect(cm.tiers[0]).toMatchObject({ position: 1 });
    expect(
      res.body.items.every(
        (p: { buyAlonePriceSen: unknown }) => typeof p.buyAlonePriceSen === 'number',
      ),
    ).toBe(true);
  });

  it('lists no payouts before a hub check', async () => {
    const res = await (await app.as('farid')).get(`/api/suppliers/${SUP_DRY}/payouts`);
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});
