import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatMytDate } from '@/lib/format';
import { mytInstant } from '@/lib/time';
import { runDueJobs } from '@/server/modules/jobs/run';
import { sendOperationalReminders } from '@/server/modules/supplier-orders/reminders';
import { createTestApp, type TestApp } from './helpers/app';
import {
  countWhatsapp,
  lastWhatsapp,
  opsApprovalOf,
  roundOf,
  supplierApprovalOf,
  supplierOrderOf,
  toFormed,
} from './helpers/scenarios';

const WEEK = '2026-W45';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

let app: TestApp;

beforeEach(async () => {
  app = await createTestApp({ seed: 'demo' });
  await toFormed(app);
});

afterEach(async () => {
  await app.close();
});

/** Sets the time the jobs see, whatever offset the demo's skip to the cut-off left behind. */
async function at(ms: number): Promise<void> {
  const { clockOffsetMs } = await app.prisma.demoSettings.findUniqueOrThrow({ where: { id: 1 } });
  app.clock.set(new Date(ms - Number(clockOffsetMs)).toISOString());
}

/** Runs the job twice at a time, as a cron that fires every few minutes would. */
async function runTwiceAt(ms: number): Promise<void> {
  await at(ms);
  await sendOperationalReminders(app.deps);
  await sendOperationalReminders(app.deps);
}

async function orderOf(productKey: string) {
  return supplierOrderOf((await roundOf(productKey, WEEK)).id);
}

async function approveByOps(productKey: string) {
  const so = await orderOf(productKey);
  const nadia = await app.as('nadia');
  const res = await nadia.post(`/api/approvals/${await opsApprovalOf(so.id)}/approve`, {});
  expect(res.status).toBe(200);
  return so;
}

async function confirmBySupplier(supplierKey: 'farid' | 'lim', soId: string) {
  const client = await app.as(supplierKey);
  const res = await client.post(`/api/approvals/${await supplierApprovalOf(soId)}/approve`, {
    expectedDispatchDate: '2026-11-07',
  });
  expect(res.status).toBe(200);
}

async function supplierName(id: string): Promise<string> {
  return (await app.prisma.supplier.findUniqueOrThrow({ where: { id } })).name;
}

type InboxItem = { id: string; overdueAt: string | null };

describe('Operational reminders', () => {
  it('reminds the supplier and tells Ops after 12 hours without confirmation (stories 116, 134)', async () => {
    const so = await approveByOps('CM');
    const approval = await app.prisma.approvalRequest.findFirstOrThrow({
      where: { type: 'supplier_confirmation', subjectId: so.id },
    });
    const start = approval.createdAt.getTime();

    await runTwiceAt(start + 12 * HOUR - MIN);
    expect(await countWhatsapp('farid', 'supplier.confirm_reminder')).toBe(0);
    expect(await countWhatsapp('nadia', 'ops.supplier_unconfirmed')).toBe(0);

    await runTwiceAt(start + 12 * HOUR);
    expect(await countWhatsapp('farid', 'supplier.confirm_reminder')).toBe(1);
    expect(await countWhatsapp('nadia', 'ops.supplier_unconfirmed')).toBe(1);
    expect(await lastWhatsapp('farid', 'supplier.confirm_reminder')).toBe(
      'Reminder: please confirm the BeliKongsi order for 105 cartons of condensed milk.',
    );
    expect(await lastWhatsapp('nadia', 'ops.supplier_unconfirmed')).toBe(
      `${await supplierName(so.supplierId)} hasn't confirmed the condensed milk order after 12 hours.`,
    );
    // Only the supplier who owes the confirmation is reminded.
    expect(await countWhatsapp('lim', 'supplier.confirm_reminder')).toBe(0);

    await runTwiceAt(start + 20 * HOUR);
    expect(await countWhatsapp('farid', 'supplier.confirm_reminder')).toBe(1);
    expect(await countWhatsapp('nadia', 'ops.supplier_unconfirmed')).toBe(1);
  });

  it('does not chase a confirmation the supplier has already answered', async () => {
    const so = await approveByOps('CM');
    const approval = await app.prisma.approvalRequest.findFirstOrThrow({
      where: { type: 'supplier_confirmation', subjectId: so.id },
    });
    await confirmBySupplier('farid', so.id);
    await runTwiceAt(approval.createdAt.getTime() + 13 * HOUR);
    expect(await countWhatsapp('farid', 'supplier.confirm_reminder')).toBe(0);
    expect(await countWhatsapp('nadia', 'ops.supplier_unconfirmed')).toBe(0);
  });

  it('marks Ops approvals overdue after 12 hours', async () => {
    const decided = await approveByOps('EGG_A');
    const pending = await app.prisma.approvalRequest.findMany({
      where: { type: 'supplier_order', status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
    expect(pending.length).toBeGreaterThan(1);
    const start = pending[0]!.createdAt.getTime();
    const nadia = await app.as('nadia');
    const inbox = async () => {
      const res = await nadia.get('/api/approvals?status=pending');
      return (res.body as { items: InboxItem[] }).items.filter((a) =>
        pending.some((p) => p.id === a.id),
      );
    };

    await runTwiceAt(start + 12 * HOUR - MIN);
    expect((await inbox()).every((a) => a.overdueAt === null)).toBe(true);
    expect(await countWhatsapp('nadia', 'ops.approval_overdue')).toBe(0);

    const overdueAt = new Date(start + 12 * HOUR);
    await runTwiceAt(overdueAt.getTime());
    const items = await inbox();
    expect(items).toHaveLength(pending.length);
    for (const item of items) expect(item.overdueAt).toBe(overdueAt.toISOString());
    expect(await countWhatsapp('nadia', 'ops.approval_overdue')).toBe(pending.length);
    // The notice carries the approval summary exactly as the inbox shows it, amount included.
    expect(await lastWhatsapp('nadia', 'ops.approval_overdue', 'condensed milk')).toBe(
      'Overdue approval: Supplier order: 105 cartons of condensed milk, RM 15,330.00.',
    );
    for (const approval of pending) {
      expect(
        await app.prisma.notification.count({
          where: {
            type: 'ops.approval_overdue',
            whatsappText: `Overdue approval: ${approval.summary}.`,
          },
        }),
      ).toBe(1);
    }
    // Suppliers are not told about Ops approvals.
    expect(await countWhatsapp('farid', 'ops.approval_overdue')).toBe(0);

    // Later runs change nothing: no new notice, and the first overdue time stays.
    await runTwiceAt(start + 30 * HOUR);
    expect(await countWhatsapp('nadia', 'ops.approval_overdue')).toBe(pending.length);
    for (const item of await inbox()) expect(item.overdueAt).toBe(overdueAt.toISOString());

    // A request decided before the 12 hours is never marked.
    const done = await app.prisma.approvalRequest.findUniqueOrThrow({
      where: { id: await opsApprovalOf(decided.id) },
    });
    expect(done.overdueAt).toBeNull();
  });

  it('marks an approval with a very long summary overdue, shortening only the WhatsApp text', async () => {
    const approval = await app.prisma.approvalRequest.findFirstOrThrow({
      where: { type: 'supplier_order', status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
    const summary = `Supplier order: ${'a very long note '.repeat(30).trim()}`;
    await app.prisma.approvalRequest.update({ where: { id: approval.id }, data: { summary } });
    await runTwiceAt(approval.createdAt.getTime() + 12 * HOUR);
    const marked = await app.prisma.approvalRequest.findUniqueOrThrow({
      where: { id: approval.id },
    });
    expect(marked.overdueAt).not.toBeNull();
    const notice = await app.prisma.notification.findFirstOrThrow({
      where: { type: 'ops.approval_overdue', body: { contains: 'a very long note' } },
    });
    expect(notice.body).toBe(`Overdue approval: ${summary}.`);
    expect(notice.whatsappText.length).toBeLessThanOrEqual(300);
    expect(notice.whatsappText).toMatch(/^Overdue approval: Supplier order: a very long note/);
    expect(notice.whatsappText.endsWith('….')).toBe(true);
  });

  it('alerts Ops about a missed dispatch date and an overdue hub check', async () => {
    const cm = await approveByOps('CM');
    await confirmBySupplier('farid', cm.id);
    const egg = await approveByOps('EGG_A');
    await confirmBySupplier('lim', egg.id);
    const sent = await (await app.as('lim')).post(`/api/supplier-orders/${egg.id}/dispatched`);
    expect(sent.status).toBe(200);

    // 23:59:59 MYT on the required dispatch date is still on time.
    const lastSecondOfDispatchDay = mytInstant(2026, 11, 7, 23, 59).getTime() + 59 * 1000;
    await runTwiceAt(lastSecondOfDispatchDay);
    expect(await countWhatsapp('nadia', 'ops.not_dispatched')).toBe(0);
    await runTwiceAt(lastSecondOfDispatchDay + 1000);
    expect(await countWhatsapp('nadia', 'ops.not_dispatched')).toBe(1);
    expect(await lastWhatsapp('nadia', 'ops.not_dispatched')).toBe(
      `Not dispatched yet: 105 cartons of condensed milk from ${await supplierName(cm.supplierId)} (due ${formatMytDate('2026-11-07')}).`,
    );
    expect(await countWhatsapp('nadia', 'ops.hub_check_overdue')).toBe(0);

    const lastSecondOfHubDay = mytInstant(2026, 11, 9, 23, 59).getTime() + 59 * 1000;
    await runTwiceAt(lastSecondOfHubDay);
    expect(await countWhatsapp('nadia', 'ops.hub_check_overdue')).toBe(0);
    await runTwiceAt(lastSecondOfHubDay + 1000);
    expect(await countWhatsapp('nadia', 'ops.hub_check_overdue')).toBe(1);
    const eggRound = await roundOf('EGG_A', WEEK);
    const product = await app.prisma.product.findUniqueOrThrow({
      where: { id: eggRound.productId },
    });
    expect(await lastWhatsapp('nadia', 'ops.hub_check_overdue')).toBe(
      `Hub check overdue: ${product.shortName} from ${await supplierName(egg.supplierId)} (expected ${formatMytDate('2026-11-09')}).`,
    );
    // Each alert is sent once, and suppliers are not told.
    expect(await countWhatsapp('nadia', 'ops.not_dispatched')).toBe(1);
    expect(await countWhatsapp('farid', 'ops.not_dispatched')).toBe(0);
    expect(await countWhatsapp('lim', 'ops.hub_check_overdue')).toBe(0);
  });

  it('reports the number of notices sent through the due jobs', async () => {
    const so = await approveByOps('CM');
    const approval = await app.prisma.approvalRequest.findFirstOrThrow({
      where: { type: 'supplier_confirmation', subjectId: so.id },
    });
    await at(approval.createdAt.getTime() + 12 * HOUR);
    expect((await runDueJobs(app.deps)).operationalReminders).toBeGreaterThan(0);
    expect((await runDueJobs(app.deps)).operationalReminders).toBe(0);
  });
});
