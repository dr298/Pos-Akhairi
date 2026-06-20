// Typed API client for pos.akhairi.com backend.
// Server runs on http://localhost:8787 (configurable via NEXT_PUBLIC_API_URL).
// All requests send credentials so the pos_session cookie flows through.

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== 'undefined' ? 'http://localhost:8787' : 'http://localhost:8787');

// WebSocket URL derived from API URL — swap http→ws, https→wss.
export const WS_URL =
  process.env.NEXT_PUBLIC_WS_URL ||
  (typeof window !== 'undefined'
    ? API_URL.replace(/^http/, 'ws')
    : 'ws://localhost:8787');

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      // ignore
    }
    const message =
      payload?.message ||
      payload?.error ||
      `Request failed: ${res.status}`;
    throw new ApiError(message, res.status, payload?.details);
  }
  // Some endpoints may return empty body.
  const text = await res.text();
  if (!text) return undefined as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined as unknown as T;
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type Role = 'OWNER' | 'MANAGER' | 'CASHIER' | 'KITCHEN';

export interface Branch {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  timezone?: string;
  isActive?: boolean;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  branchId: string;
  branch?: Branch;
}

export interface AuthResponse {
  user: User;
}

export interface Category {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface Modifier {
  id: string;
  name: string;
  priceDeltaCents: number;
}

export interface MenuItem {
  id: string;
  name: string;
  description?: string | null;
  priceCents: number;
  costCents?: number;
  categoryId: string;
  taxRateBp?: number;
  isActive: boolean;
  isAvailable: boolean;
  imageUrl?: string | null;
  sku?: string;
  category?: Category;
  modifiers?: Modifier[];
}

export type OrderType = 'DINE_IN' | 'TAKEOUT' | 'DELIVERY' | 'TAKEAWAY';
export type OrderStatus = 'OPEN' | 'PAID' | 'VOIDED' | 'REFUNDED' | 'CANCELLED';

export interface OrderItem {
  id: string;
  nameSnapshot: string;
  quantity: number;
  priceCents: number;
  lineTotalCents: number;
  notes?: string | null;
  status?: string;
  modifiersJson?: string | null;
  menuItemId?: string;
}

export interface OrderPayment {
  id: string;
  orderId: string;
  provider: string;
  method: string;
  status: string;
  amountCents: number;
  reference?: string | null;
  providerRaw?: {
    method?: string;
    amountGiven?: number;
    changeCents?: number;
    cashierId?: string;
    refund?: boolean;
  } | null;
  paidAt?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  type: OrderType;
  status: OrderStatus;
  tableNumber?: string | null;
  customerName?: string | null;
  notes?: string | null;
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  shiftId?: string | null;
  openedById?: string;
  closedById?: string | null;
  openedAt: string;
  closedAt?: string | null;
  items: OrderItem[];
  payments: OrderPayment[];
}

export interface Shift {
  id: string;
  branchId: string;
  userId: string;
  status: 'OPEN' | 'CLOSED';
  openingCents: number;
  closingCents?: number | null;
  expectedCents?: number | null;
  varianceCents?: number | null;
  openedAt: string;
  closedAt?: string | null;
  notes?: string | null;
  user?: Pick<User, 'id' | 'name' | 'email'>;
  branch?: Branch;
}

export interface PaymentProvider {
  name: string;
  methods: string[];
}

// ─── Sprint 2 Types ──────────────────────────────────────────────────────────

export type DiscountType = 'PERCENTAGE' | 'FIXED';

export interface Discount {
  id: string;
  branchId: string;
  code?: string | null;
  name: string;
  type: DiscountType;
  /** PERCENTAGE: 0-100 integer. FIXED: cents. */
  value: number;
  minOrderCents: number;
  maxDiscountCents: number | null;
  validFrom: string | null;
  validUntil: string | null;
  usageLimit: number | null;
  usageCount: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DiscountValidation {
  valid: boolean;
  discountId?: string;
  name?: string;
  discountCents: number;
  newSubtotalCents: number;
  reason?: string;
}

export type PaymentProviderName = 'CASH' | 'MIDTRANS' | 'XENDIT';
export type PaymentMethodKind = 'CASH' | 'QRIS' | 'VIRTUAL_ACCOUNT' | 'EWALLET';

export interface PaymentProviderInfo {
  name: PaymentProviderName;
  methods: PaymentMethodKind[];
}

export interface ChargePaymentInput {
  provider: PaymentProviderName;
  orderId: string;
  method: PaymentMethodKind;
  amount: number; // cents
  customer?: { name?: string; email?: string; phone?: string };
}

export interface ChargePaymentResult {
  payment: OrderPayment;
  result: {
    status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
    externalId: string;
    paymentUrl?: string;
    qrString?: string;
    vaNumber?: string;
  };
  lowStockAlerts?: Array<{
    itemId: string;
    name: string;
    currentStock: number;
    minStock: number;
  }>;
}

export interface MidtransClientKey {
  clientKey: string | null;
  env: string;
}

export interface VoidRefundRequest {
  reason: string;
}

export interface RefundRequest {
  reason: string;
  refundMethod: 'CASH' | 'ORIGINAL';
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<AuthResponse>('/api/auth/me'),
  logout: () => request<{ ok?: boolean }>('/api/auth/logout', { method: 'POST' }),

  // Menu
  getCategories: () => request<{ data: Category[] }>('/api/menu/categories'),
  getMenuItems: () => request<{ data: MenuItem[] }>('/api/menu/items'),

  // Shifts
  getCurrentShift: () => request<{ data: Shift | null }>('/api/shifts/current'),
  openShift: (openingCash: number) =>
    request<{ data: Shift }>('/api/shifts/open', {
      method: 'POST',
      body: JSON.stringify({ openingCash }),
    }),
  closeShift: (id: string, closingCash: number, notes?: string) =>
    request<{ data: Shift }>(`/api/shifts/${id}/close`, {
      method: 'POST',
      body: JSON.stringify({ closingCash, notes }),
    }),

  // Orders
  createOrder: (payload: {
    orderType: OrderType;
    items: { menuItemId: string; quantity: number; modifiers?: { modifierId: string }[]; notes?: string }[];
    tableNumber?: string | null;
    customerName?: string | null;
    notes?: string | null;
    discountCode?: string | null;
  }) =>
    request<{ data: Order }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  payCash: (orderId: string, amountGiven: number) =>
    request<{ data: { order: Order; payment: OrderPayment; changeCents: number; amountGiven: number; lowStockAlerts?: Array<{ itemId: string; name: string; currentStock: number; minStock: number }> } }>(
      `/api/orders/${orderId}/pay-cash`,
      { method: 'POST', body: JSON.stringify({ amountGiven }) },
    ),
  getOrders: () => request<{ data: Order[] }>('/api/orders'),
  getOrder: (id: string) => request<{ data: Order }>(`/api/orders/${id}`),
  voidOrder: (id: string, reason: string) =>
    request<{ data: Order }>(`/api/orders/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason } satisfies VoidRefundRequest),
    }),
  refundOrder: (id: string, reason: string, refundMethod: 'CASH' | 'ORIGINAL') =>
    request<{ data: Order }>(`/api/orders/${id}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason, refundMethod } satisfies RefundRequest),
    }),

  // Discounts
  listDiscounts: () => request<{ data: Discount[] }>('/api/discounts'),
  validateDiscount: (code: string, subtotalCents: number) =>
    request<{ data: DiscountValidation }>('/api/discounts/validate', {
      method: 'POST',
      body: JSON.stringify({ code, subtotalCents }),
    }),
  createDiscount: (payload: {
    name: string;
    code?: string;
    type: DiscountType;
    value: number;
    minOrderCents?: number;
    maxDiscountCents?: number | null;
    validFrom?: string;
    validUntil?: string;
    usageLimit?: number | null;
    isActive?: boolean;
  }) =>
    request<{ data: Discount }>('/api/discounts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateDiscount: (
    id: string,
    payload: Partial<{
      name: string;
      code: string;
      type: DiscountType;
      value: number;
      minOrderCents: number;
      maxDiscountCents: number | null;
      validFrom: string | null;
      validUntil: string | null;
      usageLimit: number | null;
      isActive: boolean;
    }>,
  ) =>
    request<{ data: Discount }>(`/api/discounts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteDiscount: (id: string) =>
    request<{ data: Discount }>(`/api/discounts/${id}`, { method: 'DELETE' }),

  // Payments
  getPaymentProviders: () =>
    request<{ data: PaymentProviderInfo[] }>('/api/payments/providers'),
  chargePayment: (input: ChargePaymentInput) =>
    request<{ data: ChargePaymentResult }>('/api/payments/charge', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getMidtransClientKey: () =>
    request<{ data: MidtransClientKey }>('/api/payments/midtrans/client-key'),
  cancelMidtransPayment: (externalId: string) =>
    request<{ data: { ok: boolean } }>(`/api/payments/midtrans/cancel/${externalId}`, {
      method: 'POST',
    }),
  cancelXenditPayment: (externalId: string) =>
    request<{ data: { ok: boolean } }>(`/api/payments/xendit/cancel/${externalId}`, {
      method: 'POST',
    }),

  // Reports
  getDailyReport: (date: string) =>
    request<{ data: unknown }>(`/api/reports/daily?date=${encodeURIComponent(date)}`),
};

export { API_URL };
