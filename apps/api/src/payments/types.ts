export type PaymentMethodKind = 'CASH' | 'QRIS' | 'VIRTUAL_ACCOUNT' | 'EWALLET';

export type PaymentRequest = {
  orderId: string;
  amount: number; // integer IDR
  method: PaymentMethodKind;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  metadata?: Record<string, unknown>;
};

export type PaymentResultStatus =
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'EXPIRED'
  | 'CANCELLED';

export type PaymentResult = {
  status: PaymentResultStatus;
  externalId: string; // provider's reference
  paymentUrl?: string; // for redirect methods
  qrString?: string; // for QRIS
  vaNumber?: string; // for VA
  expiresAt?: Date;
  raw?: unknown; // raw provider response
};

export interface PaymentProvider {
  readonly name: string; // 'CASH' | 'MIDTRANS' | 'XENDIT'
  charge(req: PaymentRequest): Promise<PaymentResult>;
  getStatus(externalId: string): Promise<PaymentResult>;
  cancel(externalId: string): Promise<{ ok: boolean }>;
}
