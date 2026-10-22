import type { Role } from '@/generated/prisma/client';
import { formatMytDate, formatMytShort, formatRM, formatUnits } from '@/lib/format';

export type NotificationMessage = { title: string; body: string; whatsappText: string };

// A builder takes the event data and returns a function from role to message,
// so a message can differ by audience (for example staff text carries no amounts).
export type TemplateBuilder<D = Record<string, unknown>> = (
  data: D,
) => (role: Role) => NotificationMessage;

/** Keeps each entry's own data type so a caller can use it type-safely. */
export function defineTemplates<T extends { [type: string]: TemplateBuilder<never> }>(
  templates: T,
): T {
  return templates;
}

// Later milestones add their PRD section 13 entries, keyed by notification type, with
// `defineTemplates({ type: (data: Data) => (role) => ({ ... }) })`.
const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const TEMPLATES = defineTemplates({
  // Owner only: staff are never told amounts, so this is not sent to them.
  'basket.ready': (data: {
    itemCount: number;
    nowSen: number;
    afterCutoffSen: number;
    deadline: Date;
  }) => {
    const items = `${data.itemCount} ${data.itemCount === 1 ? 'item' : 'items'}`;
    return () => ({
      title: 'Your basket is ready',
      body: `${items}, ${formatRM(data.nowSen)} now, about ${formatRM(data.afterCutoffSen)} after cut-off.`,
      whatsappText: `Your Kongsi basket for this week is ready: ${items}, ${formatRM(data.nowSen)} now, about ${formatRM(data.afterCutoffSen)} after cut-off. Approve by ${formatMytShort(data.deadline)}.`,
    });
  },
  // Sent to the owner when staff add to the basket; carries no amount.
  'basket.staff_added': (data: {
    staffName: string;
    quantity: number;
    unitName: string;
    shortName: string;
    when: 'this' | 'next';
  }) => {
    const text = `${data.staffName} added ${formatUnits(data.quantity, data.unitName)} of ${data.shortName} to ${data.when} week's basket.`;
    return () => ({ title: 'Staff added to your basket', body: text, whatsappText: text });
  },
  // Owner only: a basket paid for N rounds, or one round joined from the catalogue.
  'payment.succeeded': (
    data: { kind: 'basket'; roundCount: number } | { kind: 'join'; shortName: string },
  ) => {
    const text =
      data.kind === 'join'
        ? `Payment received (simulated). You're in the ${data.shortName} Kongsi.`
        : `Payment received (simulated). You're in ${data.roundCount} Kongsi ${data.roundCount === 1 ? 'round' : 'rounds'} this week.`;
    return () => ({ title: 'Payment received', body: text, whatsappText: text });
  },
  // Owner only: a line cancelled before cut-off, with everything that went back to the balance.
  'participation.cancelled': (data: {
    quantity: number;
    unitName: string;
    shortName: string;
    refundSen: number;
  }) => {
    const text = `Cancelled: ${formatUnits(data.quantity, data.unitName)} of ${data.shortName}. ${formatRM(data.refundSen)} is back in your balance.`;
    return () => ({ title: 'Cancelled', body: text, whatsappText: text });
  },
  // Owner only, sent before the basket deadline to an owner who has not decided.
  'basket.reminder': (data: { when: '24h' | '3h' }) => {
    const text = `Reminder: your Kongsi basket closes ${data.when === '24h' ? 'tomorrow' : 'today'} at 8 pm.`;
    return () => ({ title: 'Basket closing soon', body: text, whatsappText: text });
  },
  'payment.failed': (data: { kind: 'basket' } | { kind: 'join'; shortName: string }) => {
    const text =
      data.kind === 'join'
        ? `Payment failed (simulated). You haven't joined the ${data.shortName} Kongsi. Tap to try again.`
        : 'Payment failed (simulated). Your basket is unchanged. Tap to try again.';
    return () => ({ title: 'Payment failed', body: text, whatsappText: text });
  },
  // Owner only: the round closed and the shop's lines were kept (refund omitted when 0).
  'round.kept': (data: {
    shortName: string;
    unitName: string;
    finalUnitPriceSen: number;
    totalKept: number;
    shopCount: number;
    refundSen: number;
    readyAt: Date | null;
  }) => {
    const text =
      `${cap(data.shortName)} closed at ${formatRM(data.finalUnitPriceSen)} a ${data.unitName} ` +
      `(${formatUnits(data.totalKept, data.unitName)}, ${formatUnits(data.shopCount, 'shop')}).` +
      (data.refundSen > 0 ? ` ${formatRM(data.refundSen)} is back in your balance.` : '') +
      (data.readyAt ? ` Ready ${formatMytDate(data.readyAt)}.` : '');
    return () => ({ title: 'Your round closed', body: text, whatsappText: text });
  },
  // Owner only: the final all-in price went above the shop's limit, so the lines were refunded.
  'round.dropped': (data: {
    shortName: string;
    allInSen: number;
    limitSen: number;
    refundSen: number;
  }) => {
    const text = `${cap(data.shortName)} closed at ${formatRM(data.allInSen)} all-in, above your limit of ${formatRM(data.limitSen)}. Full refund: ${formatRM(data.refundSen)}.`;
    return () => ({ title: 'Dropped: over your limit', body: text, whatsappText: text });
  },
  // Owner only: the round did not reach its first tier. The next-round sentence is left out
  // when the product has no next round.
  'round.failed': (data: {
    shortName: string;
    unitName: string;
    minQuantity: number;
    refundSen: number;
    nextCutoff: Date | null;
  }) => {
    const text =
      `${cap(data.shortName)} didn't reach ${formatUnits(data.minQuantity, data.unitName)}. Full refund: ${formatRM(data.refundSen)}.` +
      (data.nextCutoff ? ` Next round closes ${formatMytDate(data.nextCutoff)}.` : '');
    return () => ({ title: "Round didn't form", body: text, whatsappText: text });
  },
  // Ops only: a supplier order is drafted and waits for approval. shortName stays lowercase.
  'ops.approval_needed': (data: { shortName: string; totalSen: number }) => {
    const text = `Supplier order awaiting approval: ${data.shortName}, ${formatRM(data.totalSen)}.`;
    return () => ({ title: 'Supplier order awaiting approval', body: text, whatsappText: text });
  },
  // Supplier only: Ops approved the order. The hub label is the region, never a shop.
  'supplier.new_order': (data: {
    quantity: number;
    unitName: string;
    shortName: string;
    hubLabel: string;
  }) => {
    const text = `New BeliKongsi order: ${formatUnits(data.quantity, data.unitName)} of ${data.shortName} for the ${data.hubLabel}. Please confirm.`;
    return () => ({ title: 'New order to confirm', body: text, whatsappText: text });
  },
  // Ops only: the supplier turned an order down.
  'ops.supplier_rejected': (data: { supplierName: string; shortName: string; reason: string }) => {
    const reason = data.reason.trim().replace(/[\s.,;:!?]+$/, '');
    const text = `${data.supplierName} rejected the ${data.shortName} order: ${reason}.`;
    // The full reason stays in the body; the WhatsApp text must fit the 300-character limit.
    const prefix = `${data.supplierName} rejected the ${data.shortName} order: `;
    const room = 300 - prefix.length - 2;
    const short =
      reason.length > room ? `${reason.slice(0, Math.max(room, 1) - 1).trimEnd()}…` : reason;
    return () => ({
      title: 'Supplier rejected an order',
      body: text,
      whatsappText: `${prefix}${short}.`,
    });
  },
  // Owner only: the round was cancelled and everything the shop paid for it went back.
  'owner.order_rejected': (data: {
    by: 'ops' | 'supplier';
    shortName: string;
    refundSen: number;
  }) => {
    const text =
      data.by === 'supplier'
        ? `The supplier couldn't fill ${data.shortName} this week. Full refund: ${formatRM(data.refundSen)}.`
        : `BeliKongsi cancelled the ${data.shortName} order this week. Full refund: ${formatRM(data.refundSen)}.`;
    return () => ({ title: 'Order cancelled, full refund', body: text, whatsappText: text });
  },
  // Owner only: the supplier delivered fewer good units than were ordered; one message per shop.
  'owner.shortfall': (data: {
    missingUnits: number;
    unitName: string;
    shortName: string;
    refundSen: number;
  }) => {
    const text = `The supplier delivered short. ${formatUnits(data.missingUnits, data.unitName)} of ${data.shortName} refunded: ${formatRM(data.refundSen)}.`;
    return () => ({ title: 'Delivered short, refunded', body: text, whatsappText: text });
  },
  // Supplier only: the simulated payout for the good units counted at the hub.
  'supplier.payout': (data: { amountSen: number; units: number; unitName: string }) => {
    const text = `Payment released: ${formatRM(data.amountSen)} for ${formatUnits(data.units, data.unitName)} (simulated).`;
    return () => ({ title: 'Payment released', body: text, whatsappText: text });
  },
});
