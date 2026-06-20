// Typed API client for pos.akhairi.com backend.
// API_URL is prepended to every request path. In production it should be a
// relative path '' (empty) so the browser resolves the fetch as
// `https://pos.akhairi.com/api/...` — this hits the Next.js rewrite which
// forwards server-side to the internal api:8787 container with cookies
// flowing through the same origin. In dev, set NEXT_PUBLIC_API_URL to the
// full backend origin (e.g. http://localhost:8787) and the call sites'
// '/api/...' paths will hit the API directly.
//
// Path convention: call sites pass paths *with* the '/api/...' prefix.
// This file does NOT touch the path.

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  '';

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
  // Sprint 5.5b — list of all branches the user can switch to.
  // Length === 1 means no switcher UI; > 1 shows the dropdown.
  branchAccess?: Array<{
    branchId: string;
    role: Role;
    isDefault: boolean;
    branch: Branch;
  }>;
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

// ─── Sprint 3: Delivery channels ─────────────────────────────────────────────

export type Channel = 'GOFOOD' | 'GRABFOOD' | 'SHOPEEFOOD';
export type ChannelOrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY'
  | 'PICKED_UP'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'REJECTED';

export interface ChannelConfig {
  id: string;
  branchId: string;
  channel: Channel | 'POS' | 'MANUAL';
  enabled: boolean;
  storeId: string | null;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  hasWebhookSecret: boolean;
  pollIntervalSec: number;
  lastPolledAt: string | null;
  configJson: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelConfigUpsertInput {
  enabled: boolean;
  storeId: string;
  apiKey: string;
  apiSecret: string;
  webhookSecret?: string;
  pollIntervalSec?: number;
  configJson?: Record<string, unknown>;
}

export interface ChannelOrderItem {
  externalSku: string;
  name: string;
  quantity: number;
  priceCents: number;
  notes?: string;
  modifiers?: { name: string; priceCents: number }[];
}

export interface ChannelOrder {
  id: string;
  branchId: string;
  channel: Channel;
  externalId: string;
  externalRef: string | null;
  status: ChannelOrderStatus;
  customerName: string | null;
  customerPhone: string | null;
  deliveryAddress: string | null;
  deliveryLat: string | null;
  deliveryLng: string | null;
  deliveryNotes: string | null;
  driverName: string | null;
  driverPhone: string | null;
  subtotalCents: number;
  deliveryFeeCents: number;
  serviceFeeCents: number;
  discountCents: number;
  commissionCents: number;
  totalCents: number;
  orderId: string | null;
  itemsJson: ChannelOrderItem[];
  receivedAt: string;
  acceptedAt: string | null;
  preparedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface ChannelOrderEvent {
  id: string;
  status: ChannelOrderStatus;
  actor: string;
  note: string | null;
  createdAt: string;
}

export interface ChainReportBranch {
  id: string;
  code: string;
  name: string;
  city: string | null;
}
export interface ChainReportEntry {
  branch: ChainReportBranch;
  orders: {
    total: number;
    paid: number;
    voided: number;
    refunded: number;
    grossCents: number;
  };
  payments: Record<string, number>;
  dailyClose: { status: string; grossCents: number; netCents: number } | null;
  mismatches: number;
}
export interface ChainReport {
  date: string;
  totals: {
    branches: number;
    orders: number;
    grossCents: number;
    mismatches: number;
  };
  branches: ChainReportEntry[];
}

export interface ChannelOrderDetail extends ChannelOrder {
  events: ChannelOrderEvent[];
}

export interface ChannelAnalyticsByStatus {
  [status: string]: number;
}

export interface ChannelAnalyticsChannel {
  channel: string;
  orderCount: number;
  totalRevenueCents: number;
  totalCommissionCents: number;
  totalDeliveryFeeCents: number;
  byStatus: ChannelAnalyticsByStatus;
}

export interface ChannelAnalyticsDaily {
  day: string;
  channel: string;
  orderCount: number;
  revenueCents: number;
}

export interface ChannelAnalyticsSummary {
  windowDays: number;
  byChannel: ChannelAnalyticsChannel[];
  daily: ChannelAnalyticsDaily[];
}

// Sprint 5.2 — Stock transfers
export type StockTransferStatus = 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED';

export interface StockTransferItem {
  id: string;
  transferId: string;
  inventoryItemId: string;
  qtyTransferred: number;
  qtyReceived: number | null;
  inventoryItem?: {
    id: string;
    sku: string;
    name: string;
    unit: string;
    branchId?: string;
  };
}

export interface StockTransfer {
  id: string;
  fromBranchId: string;
  toBranchId: string;
  status: StockTransferStatus;
  notes: string | null;
  createdById: string;
  sentById: string | null;
  receivedById: string | null;
  createdAt: string;
  sentAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  fromBranch?: { id: string; code: string; name: string };
  toBranch?: { id: string; code: string; name: string };
  createdBy?: { name: string };
  sentBy?: { name: string };
  receivedBy?: { name: string };
  items: StockTransferItem[];
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
  // Sprint 5.5b — switch active branch (sets pos_branch cookie server-side)
  switchBranch: (branchId: string) =>
    request<{ ok: boolean; branchId: string; role: Role }>('/api/auth/me/branch', {
      method: 'POST',
      body: JSON.stringify({ branchId }),
    }),

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
  // Sprint 4.4: chain report (OWNER only)
  getChainReport: (date: string) =>
    request<{ data: ChainReport }>(`/api/reports/chain?date=${encodeURIComponent(date)}`),

  // Channels (Sprint 3)
  listChannels: () => request<{ data: ChannelConfig[] }>('/api/channels'),
  upsertChannel: (
    channel: 'GOFOOD' | 'GRABFOOD' | 'SHOPEEFOOD',
    payload: ChannelConfigUpsertInput,
  ) =>
    request<{ data: ChannelConfig }>(`/api/channels/${channel}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteChannel: (channel: 'GOFOOD' | 'GRABFOOD' | 'SHOPEEFOOD') =>
    request<{ data: { deleted: boolean } }>(`/api/channels/${channel}`, {
      method: 'DELETE',
    }),
  testChannel: (channel: 'GOFOOD' | 'GRABFOOD' | 'SHOPEEFOOD') =>
    request<{ data: { ok: boolean; message: string } }>(`/api/channels/${channel}/test`, {
      method: 'POST',
    }),
  pollChannel: (channel: 'GOFOOD' | 'GRABFOOD' | 'SHOPEEFOOD') =>
    request<{ data: { polled: number } }>(`/api/channels/${channel}/poll`, {
      method: 'POST',
    }),
  syncChannelMenu: (channel: 'GOFOOD' | 'GRABFOOD' | 'SHOPEEFOOD') =>
    // Same as pollChannel for now; future: bulk menu push
    request<{ data: { polled: number } }>(`/api/channels/${channel}/poll`, {
      method: 'POST',
    }),

  // Channel orders
  listChannelOrders: (filter?: { status?: ChannelOrderStatus; channel?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (filter?.status) qs.set('status', filter.status);
    if (filter?.channel) qs.set('channel', filter.channel);
    if (filter?.limit) qs.set('limit', String(filter.limit));
    const q = qs.toString();
    return request<{ data: ChannelOrder[] }>(`/api/channel-orders${q ? `?${q}` : ''}`);
  },
  getChannelOrder: (id: string) =>
    request<{ data: ChannelOrderDetail }>(`/api/channel-orders/${id}`),
  acceptChannelOrder: (id: string, prepMinutes = 15) =>
    request<{ data: { id: string; orderId: string; status: string } }>(
      `/api/channel-orders/${id}/accept`,
      { method: 'POST', body: JSON.stringify({ prepMinutes }) },
    ),
  rejectChannelOrder: (id: string, reason: string) =>
    request<{ data: { id: string; status: string } }>(`/api/channel-orders/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  updateChannelOrderStatus: (id: string, status: ChannelOrderStatus, note?: string) =>
    request<{ data: { id: string; status: string } }>(`/api/channel-orders/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, note }),
    }),

  // Channel analytics
  getChannelAnalyticsSummary: (days = 7) =>
    request<{ data: ChannelAnalyticsSummary }>(
      `/api/channel-analytics/summary?days=${days}`,
    ),

  // Sprint 5.2 — Stock transfers
  listTransfers: (params?: { status?: string; branchId?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.branchId) q.set('branchId', params.branchId);
    const qs = q.toString();
    return request<{ data: { transfers: StockTransfer[] } }>(
      `/api/transfers${qs ? `?${qs}` : ''}`,
    );
  },
  getTransfer: (id: string) =>
    request<{ data: { transfer: StockTransfer } }>(`/api/transfers/${id}`),
  createTransfer: (payload: {
    fromBranchId: string;
    toBranchId: string;
    notes?: string;
    items: Array<{ inventoryItemId: string; qtyTransferred: number }>;
  }) =>
    request<{ data: { transfer: StockTransfer } }>('/api/transfers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  sendTransfer: (id: string) =>
    request<{ data: { transfer: StockTransfer } }>(`/api/transfers/${id}/send`, { method: 'POST' }),
  receiveTransfer: (id: string, items?: Array<{ transferItemId: string; qtyReceived: number }>) =>
    request<{ data: { transfer: StockTransfer } }>(`/api/transfers/${id}/receive`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
  cancelTransfer: (id: string) =>
    request<{ data: { transfer: StockTransfer } }>(`/api/transfers/${id}/cancel`, { method: 'POST' }),
};

export { API_URL };
