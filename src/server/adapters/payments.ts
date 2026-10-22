import { randomBytes } from 'node:crypto';

/** The payment partner: takes money in at checkout and pays suppliers out. */
export interface PaymentsPartner {
  startCheckout(i: { paymentId: string; amountSen: number }): Promise<{ reference: string }>;
  payout(i: {
    supplierOrderId: string;
    supplierId: string;
    amountSen: number;
  }): Promise<{ reference: string }>;
}

const hex8 = () => randomBytes(4).toString('hex').toUpperCase();

/** A simulated partner: no real money moves, and every reference is made up. */
export const simulatedPayments: PaymentsPartner = {
  async startCheckout() {
    return { reference: `SIM-PAY-${hex8()}` };
  },
  async payout() {
    return { reference: `SIM-OUT-${hex8()}` };
  },
};
