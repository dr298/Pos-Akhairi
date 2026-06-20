import type { PaymentProvider, PaymentRequest, PaymentResult } from './types.js';

export type CashChargeResult = PaymentResult & { paidAt: string };

// Cash is settled at the counter. charge() returns PAID immediately.
export const cashProvider: PaymentProvider = {
  name: 'CASH',
  async charge(req: PaymentRequest): Promise<PaymentResult> {
    const paidAt = new Date().toISOString();
    return {
      status: 'PAID',
      externalId: `CASH-${req.orderId}-${Math.random().toString(36).slice(2, 10)}`,
      raw: { method: 'CASH', orderId: req.orderId, amount: req.amount, paidAt },
    };
  },
  async getStatus(externalId: string): Promise<PaymentResult> {
    return { status: 'PAID', externalId };
  },
  async cancel(_externalId: string): Promise<{ ok: boolean }> {
    return { ok: true };
  },
};
