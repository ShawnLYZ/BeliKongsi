import { randomBytes } from 'node:crypto';

/** The payment partner: takes money in at checkout and pays suppliers out. */
export interface PaymentsPartner {
  startCheckout(i: { paymentId: string; amountSen: number }): Promise<{ reference: string }>;
  payout(i: {
    supplierOrderId: string;
    supplierId: string;
    amountSen: number;
  }): Promise<{ reference: string }>;
  /** Sets up a DuitNow AutoDebit mandate for a shop. Only the reference is kept. */
  createMandate(shopId: string): Promise<{ reference: string }>;
  /** Takes money from the shop's mandate. Rejects when the bank declines. */
  autoDebit(i: {
    mandateReference: string;
    amountSen: number;
    paymentId: string;
  }): Promise<{ reference: string }>;
  /** Sends money from the shop's balance to its own bank account. */
  withdraw(i: { shopId: string; amountSen: number }): Promise<{ reference: string }>;
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
  async createMandate() {
    return { reference: `SIM-MANDATE-${hex8()}` };
  },
  async autoDebit() {
    return { reference: `SIM-DEBIT-${hex8()}` };
  },
  async withdraw() {
    return { reference: `SIM-WD-${hex8()}` };
  },
};
