import type { Role } from '@/generated/prisma/client';
import {
  formatMytDate,
  formatMytShort,
  formatPickupCode,
  formatRM,
  formatUnits,
} from '@/lib/format';

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
  // Owner only: the auto-approve rule approved and paid the basket (balance first, then the mandate).
  // How it was paid follows the split: all by AutoDebit, balance and AutoDebit, or balance alone.
  'basket.auto_approved': (data: {
    itemCount: number;
    totalSen: number;
    balanceAppliedSen: number;
    externalSen: number;
    deadline: Date;
  }) => {
    const items = `${data.itemCount} ${data.itemCount === 1 ? 'item' : 'items'}`;
    const paid =
      data.balanceAppliedSen === 0
        ? 'paid by DuitNow AutoDebit (simulated)'
        : data.externalSen === 0
          ? 'paid from your balance'
          : `paid — ${formatRM(data.balanceAppliedSen)} from your balance and ${formatRM(data.externalSen)} by DuitNow AutoDebit (simulated)`;
    const text = `Your basket was approved automatically: ${items}, ${formatRM(data.totalSen)} ${paid}. You can still cancel any item before ${formatMytShort(data.deadline)}.`;
    return () => ({ title: 'Basket approved automatically', body: text, whatsappText: text });
  },
  'basket.auto_approve_failed': (data: { deadline: Date }) => {
    const text = `Automatic payment failed (simulated). Please approve and pay your basket by ${formatMytShort(data.deadline)}.`;
    return () => ({ title: 'Automatic payment failed', body: text, whatsappText: text });
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
  // Owner only: the balance was sent to the shop's bank account through the partner (simulated).
  'balance.withdrawn': (data: { amountSen: number; reference: string }) => {
    const text = `Withdrawal sent (simulated): ${formatRM(data.amountSen)} to the bank account registered with the payments partner. Reference ${data.reference}.`;
    return () => ({ title: 'Withdrawal sent', body: text, whatsappText: text });
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
  // Owner and staff: every good of a pickup is at the pickup point (C4).
  'pickup.ready': (data: { placeName: string; openingHours: string; code: string }) => {
    const text = `Ready at ${data.placeName} (${data.openingHours}). Pickup code ${formatPickupCode(data.code)}.`;
    return () => ({ title: 'Ready for pickup', body: text, whatsappText: text });
  },
  // Owner and staff: a door pickup's goods are on the way today.
  'pickup.out_for_delivery': (data: { code: string }) => {
    const text = `Your goods are out for delivery today. Have code ${formatPickupCode(data.code)} ready.`;
    return () => ({ title: 'Out for delivery', body: text, whatsappText: text });
  },
  // Owner and staff: a door pickup was handed over.
  'pickup.delivered': () => {
    const text = 'Your goods were delivered. Please check them now.';
    return () => ({ title: 'Delivered', body: text, whatsappText: text });
  },
  // Owner: who reported, what and the claim total. Staff: the same without the amount.
  'claim.submitted': (data: {
    reporterName: string;
    lines: { missing: number; damaged: number; unitName: string; shortName: string }[];
    totalSen: number;
  }) => {
    const phrase = (l: (typeof data.lines)[number], withKind: boolean) => {
      const base = `${formatUnits(l.missing + l.damaged, l.unitName)} of ${l.shortName}`;
      if (!withKind) return base;
      const kind =
        l.missing > 0 && l.damaged > 0
          ? 'missing and damaged'
          : l.missing > 0
            ? 'missing'
            : 'damaged';
      return `${base} (${kind})`;
    };
    // A long list is shortened so the message stays within the WhatsApp limit.
    const join = (withKind: boolean) => {
      const all = data.lines.map((l) => phrase(l, withKind));
      return all.length > 3
        ? `${all.slice(0, 2).join(', ')} and ${all.length - 2} more`
        : all.join(', ');
    };
    const owner = `${data.reporterName} reported a problem: ${join(true)}. Claim for ${formatRM(data.totalSen)} sent to BeliKongsi.`;
    const staff = `Problem reported: ${join(false)}. BeliKongsi will check it.`;
    return (role: Role) => ({
      title: 'Problem reported',
      body: role === 'staff' ? staff : owner,
      whatsappText: role === 'staff' ? staff : owner,
    });
  },
  // Owner: the decision with the refund. Staff: the same without the amount. A rejection gives
  // Ops's reason to both. The unit phrase puts the adjective before the unit noun.
  'claim.decided': (
    data:
      | {
          decision: 'approved';
          refundSen: number;
          units: number;
          kind: 'missing' | 'damaged' | 'missing or damaged';
          unitName: string;
        }
      | { decision: 'rejected'; reason: string },
  ) => {
    if (data.decision === 'rejected') {
      const reason = data.reason.trim().replace(/[\s.,;:!?]+$/, '');
      const prefix = 'Claim rejected: ';
      const room = 300 - prefix.length - 1;
      const short =
        reason.length > room ? `${reason.slice(0, Math.max(room, 1) - 1).trimEnd()}…` : reason;
      return () => ({
        title: 'Claim rejected',
        body: `${prefix}${reason}.`,
        whatsappText: `${prefix}${short}.`,
      });
    }
    const phrase = formatUnits(data.units, `${data.kind} ${data.unitName}`);
    const owner = `Claim approved: ${formatRM(data.refundSen)} refunded for ${phrase}.`;
    const staff = `Claim approved for ${phrase}.`;
    return (role: Role) => ({
      title: 'Claim approved',
      body: role === 'staff' ? staff : owner,
      whatsappText: role === 'staff' ? staff : owner,
    });
  },
  // Ops only: a claim waits for a decision.
  'ops.claim_needed': (data: { shopName: string; totalSen: number }) => {
    const text = `Claim awaiting decision: ${data.shopName}, ${formatRM(data.totalSen)}.`;
    return () => ({ title: 'Claim awaiting decision', body: text, whatsappText: text });
  },
  // Owner only: Ops did not approve the deletion request. An approval deletes the owner's notices.
  'deletion.decided': (data: { reason: string }) => {
    const reason = data.reason.trim().replace(/[\s.,;:!?]+$/, '');
    const prefix = 'Your data deletion request was not approved: ';
    const room = 300 - prefix.length - 1;
    const short =
      reason.length > room ? `${reason.slice(0, Math.max(room, 1) - 1).trimEnd()}…` : reason;
    return () => ({
      title: 'Deletion request not approved',
      body: `${prefix}${reason}.`,
      whatsappText: `${prefix}${short}.`,
    });
  },
  // Owner only: last month's verified figures, sent from 09:00 on the 1st.
  'savings.monthly_summary': (data: {
    monthName: string;
    roundsJoined: number;
    unitsBought: number;
    refundsSen: number;
    feesSen: number;
    verifiedSen: number;
  }) => {
    const text = `Your BeliKongsi summary for ${data.monthName}: ${data.roundsJoined} rounds, ${data.unitsBought} units, ${formatRM(data.refundsSen)} refunded, ${formatRM(data.feesSen)} in fees, ${formatRM(data.verifiedSen)} verified savings.`;
    return () => ({ title: `Your ${data.monthName} summary`, body: text, whatsappText: text });
  },
});
