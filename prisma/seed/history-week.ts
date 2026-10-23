import type { ApprovalType } from '@/generated/prisma/client';
import { decideApproval } from '@/server/modules/approvals/approvals';
import { submitDeliveryCheck } from '@/server/modules/checks/delivery-check';
import {
  changeConsignmentStatus,
  type PartnerStatus,
} from '@/server/modules/fulfilment/consignments';
import { handOverWithCode } from '@/server/modules/fulfilment/pickups';
import { closeDueRounds } from '@/server/modules/rounds/close';
import { recordHubCheck } from '@/server/modules/supplier-orders/hub-check';
import { markDispatched } from '@/server/modules/supplier-orders/supplier-decision';
import type { Caller } from '@/server/platform/caller';
import { withTransaction, type TxContext } from '@/server/platform/tx';
import { PRODUCTS } from './catalogue';
import { seedId, type SeedUserKey } from './ids';
import { atTimesFrom, DAY_MS, HOUR_MS, MINUTE_MS, openJoinAndPay, seededPerson } from './week';

const WEEKLY_PRODUCTS = new Set(PRODUCTS.filter((p) => p.cadence === 'weekly').map((p) => p.key));

/** Times relative to the history week's Monday 06:05 MYT (index §5.1). */
const CUTOFF = 3 * DAY_MS + 13 * HOUR_MS + 55 * MINUTE_MS; // Thu 20:00
const OPS_APPROVES = 4 * DAY_MS + 2 * HOUR_MS + 55 * MINUTE_MS; // Fri 09:00
const SUPPLIERS_CONFIRM = 4 * DAY_MS + 4 * HOUR_MS + 55 * MINUTE_MS; // Fri 11:00
const SUPPLIERS_DISPATCH = 4 * DAY_MS + 8 * HOUR_MS + 55 * MINUTE_MS; // Fri 15:00
const HUB_CHECKED = 5 * DAY_MS + 3 * HOUR_MS + 55 * MINUTE_MS; // Sat 10:00
const CONSIGNMENTS_SENT = 5 * DAY_MS + 7 * HOUR_MS + 55 * MINUTE_MS; // Sat 14:00
const CONSIGNMENTS_THERE = 6 * DAY_MS + 3 * HOUR_MS + 55 * MINUTE_MS; // Sun 10:00
const STAFF_COLLECT = 6 * DAY_MS + 5 * HOUR_MS + 55 * MINUTE_MS; // Sun 12:00
const STAFF_CHECK = 6 * DAY_MS + 6 * HOUR_MS; // Sun 12:05

/** Each supplier's order-desk user (index §5.3). */
const ORDER_DESK: Record<string, SeedUserKey> = {
  [seedId('supplier', 'SUP_DRY')]: 'farid',
  [seedId('supplier', 'SUP_EGG')]: 'lim',
  [seedId('supplier', 'SUP_PACK')]: 'priya',
};

/** The staff who collect and check Gerai's and Kafe's goods. */
const STAFF: [shopKey: string, userKey: SeedUserKey][] = [
  ['GERAI', 'kumar'],
  ['KAFE', 'danial'],
];

/**
 * Builds the week before the demo week (index §5.1), completed, through the real services inside
 * the seed's transaction (dates for the test anchor). Rounds open Thursday 22 Oct 8 pm (the weekly
 * ones of week 44, the fortnightly ones of week 45), background shops join the weekly rounds, and
 * Gerai's and Kafe's baskets are paid Monday 26 Oct. At the cut-off the rounds close (the next
 * weekly ones open); Nadia approves every order, the suppliers confirm and dispatch, the hub check
 * finds everything good, the consignments go out and arrive, and Kumar and Danial collect and
 * check "All received" on Sunday 1 Nov. The transaction's own time is restored at the end.
 */
export async function seedHistoryWeek(ctx: TxContext, anchorMonday: Date): Promise<void> {
  const { deps, tx } = ctx;
  const monday = new Date(anchorMonday.getTime() - 7 * DAY_MS);
  await atTimesFrom(ctx, monday, async (at) => {
    await openJoinAndPay(ctx, monday, at, WEEKLY_PRODUCTS);

    // Thursday 20:00: the cut-off.
    at(CUTOFF);
    await closeDueRounds(deps);
    const orders = await tx.supplierOrder.findMany({
      where: { status: 'awaiting_ops' },
      orderBy: { id: 'asc' },
    });
    const nadia = await seededPerson(ctx, 'nadia');
    const orderDesk = new Map<string, Caller>();
    for (const [supplierId, userKey] of Object.entries(ORDER_DESK)) {
      orderDesk.set(supplierId, await seededPerson(ctx, userKey));
    }
    const pendingApproval = async (type: ApprovalType, id: string) =>
      (
        await tx.approvalRequest.findFirstOrThrow({
          where: { type, subjectId: id, status: 'pending' },
          select: { id: true },
        })
      ).id;

    // Friday: Ops approves at 09:00, the suppliers confirm for the required date at 11:00 and
    // dispatch at 15:00.
    at(OPS_APPROVES);
    for (const o of orders) {
      await decideApproval(deps, nadia, await pendingApproval('supplier_order', o.id), {
        decision: 'approve',
      });
    }
    at(SUPPLIERS_CONFIRM);
    for (const o of orders) {
      await decideApproval(
        deps,
        orderDesk.get(o.supplierId)!,
        await pendingApproval('supplier_confirmation', o.id),
        { decision: 'approve', expectedDispatchDate: o.requiredDispatchDate },
      );
    }
    at(SUPPLIERS_DISPATCH);
    for (const o of orders) await markDispatched(deps, orderDesk.get(o.supplierId)!, o.id);

    // Saturday: every unit good at the hub at 10:00; the consignments leave at 14:00.
    at(HUB_CHECKED);
    for (const o of orders) {
      await recordHubCheck(deps, nadia, o.id, { goodUnits: o.acceptedQuantity, damagedUnits: 0 });
    }
    const consignments = await tx.consignment.findMany({
      where: { status: 'planned' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, destinationType: true },
    });
    const move = (id: string, status: PartnerStatus) =>
      withTransaction(deps, nadia, (c) => changeConsignmentStatus(c, id, status));
    at(CONSIGNMENTS_SENT);
    for (const c of consignments) await move(c.id, 'dispatched');

    // Sunday 10:00: at the pickup points or delivered (background shops' pickups close on their
    // own); at 12:00 Kumar and Danial take their goods with the code and at 12:05 check them.
    at(CONSIGNMENTS_THERE);
    for (const c of consignments) {
      if (c.destinationType === 'door') {
        await move(c.id, 'out_for_delivery');
        await move(c.id, 'delivered');
      } else {
        await move(c.id, 'arrived');
      }
    }
    const handOvers: { staff: Caller; pickupId: string; code: string }[] = [];
    for (const [shopKey, userKey] of STAFF) {
      const staff = await seededPerson(ctx, userKey);
      const pickups = await tx.pickup.findMany({
        where: { shopId: seedId('shop', shopKey), status: { in: ['ready', 'out_for_delivery'] } },
        orderBy: { id: 'asc' },
      });
      for (const p of pickups) handOvers.push({ staff, pickupId: p.id, code: p.code });
    }
    at(STAFF_COLLECT);
    for (const h of handOvers) {
      await withTransaction(deps, h.staff, (c) =>
        handOverWithCode(c, h.pickupId, { code: h.code }),
      );
    }
    at(STAFF_CHECK);
    for (const h of handOvers) {
      await submitDeliveryCheck(deps, h.staff, h.pickupId, { allReceived: true });
    }
  });
}
