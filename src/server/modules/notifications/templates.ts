import type { Role } from '@/generated/prisma/client';
import { formatMytShort, formatRM, formatUnits } from '@/lib/format';

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
});
