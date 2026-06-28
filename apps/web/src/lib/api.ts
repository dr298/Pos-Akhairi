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

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
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

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  unit: string;
  quantity: string;
  reorderPoint: string;
  costPerUnit: string;
  isActive: boolean;
  createdAt?: string;
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
  // Sprint 8.11 — optional barcode for scanner lookup.
  barcode?: string | null;
  category?: Category;
  modifiers?: Modifier[];
  // Sprint 12 — HPP from Recipe + FIFO.
  // `hppSource` is 'RECIPE' once a recipe is configured; the auto-
  // computed HPP lives in `computedHppCents` and is what the UI
  // should display in margin/engineering pages. `hppBreakdown` is
  // shown on hover (or in the menu-edit dialog) for transparency.
  hppSource?: 'RECIPE' | 'MANUAL';
  computedHppCents?: number;
  hppBreakdown?: Array<{
    inventoryItemId: string;
    name: string;
    qty: number;
    costPerUnit: number;
    cents: number;
  }>;
  hppShortfall?: boolean;
  displayName?: string;
  recipes?: Array<{
    id: string;
    inventoryItemId: string;
    quantity: number;
    unit: string;
    inventoryItem?: {
      id: string;
      name: string;
      unit: string;
      costPerUnit: number;
    };
  }>;
}

export type OrderType = 'DINE_IN' | 'TAKEOUT' | 'TAKEAWAY' | 'KIOSK'; // UI = DINE_IN | TAKEOUT; server returns TAKEAWAY | KIOSK too
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
  // Sprint 12 — HPP locked at payment time. `hppCentsUsed` is the
  // FIFO-derived cost basis (sum of recipe.qty × oldest batch cost).
  // `batchConsumptions` is the per-batch audit trail — useful for
  // "where did this order's cost come from?" reports.
  hppCentsUsed?: number | null;
  batchConsumptions?: Array<{
    batchId: string;
    inventoryItemId: string;
    qty: number;
    costPerUnit: number;
  }> | null;
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
}

export interface PaymentProvider {
  name: string;
  methods: string[];
}

// ─── Sprint 2 Types ──────────────────────────────────────────────────────────

export type DiscountType = 'PERCENTAGE' | 'FIXED';

export interface Discount {
  id: string;
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

// ─── Sprint 8.6 — Combos ───────────────────────────────────────────────────

export interface ComboItem {
  id: string;
  comboId: string;
  menuItemId: string;
  quantity: number;
  overridesPriceCents: number | null;
  // Server enriches with menuItem summary when present
  menuItem?: { id: string; name: string; priceCents: number } | null;
}

export interface Combo {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  imageUrl: string | null;
  isActive: boolean;
  validFrom: string | null;
  validUntil: string | null;
  createdAt: string;
  updatedAt: string;
  items: ComboItem[];
}

export interface ComboPriceBreakdown {
  comboId: string;
  comboName: string;
  comboPriceCents: number;
  itemsTotalCents: number;
  savingsCents: number;
  items: Array<{
    menuItemId: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
}

// ─── Sprint 8.7 — Promos ───────────────────────────────────────────────────

export type PromoType = 'PERCENT' | 'AMOUNT' | 'BUY_X_GET_Y' | 'BUNDLE';

export interface PromoCondition {
  id: string;
  promoId: string;
  menuItemId: string | null;
  categoryId: string | null;
  minQuantity: number;
}

export interface PromoReward {
  id: string;
  promoId: string;
  freeMenuItemId: string | null;
  freeQuantity: number;
  discountPercentBp: number | null;
  discountCents: number | null;
}

export interface Promo {
  id: string;
  code: string;
  name: string;
  type: PromoType;
  valueCents: number | null;
  percentBp: number | null;
  minSubtotalCents: number;
  maxDiscountCents: number | null;
  validFrom: string;
  validUntil: string;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  requiresMember: boolean;
  createdAt: string;
  updatedAt: string;
  conditions: PromoCondition[];
  rewards: PromoReward[];
}

export interface PromoValidation {
  valid: boolean;
  promoId?: string;
  name?: string;
  discountCents: number;
  freeItems: Array<{ menuItemId: string; name?: string; quantity: number }>;
  reason?: string;
}

// ─── Sprint 8.8 — Customers / Members ──────────────────────────────────────

export interface Customer {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  birthday: string | null;
  address: string | null;
  notes: string | null;
  loyaltyPoints: number;
  // JS-side it's a string (Prisma BigInt). UI just displays formatted.
  totalSpentCents: string | number;
  visitCount: number;
  lastVisitAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type LoyaltyTransactionType = 'EARN' | 'REDEEM' | 'ADJUST' | 'BONUS';

export interface LoyaltyTransaction {
  id: string;
  customerId: string;
  orderId: string | null;
  type: LoyaltyTransactionType;
  pointsDelta: number;
  amountCents: number | null;
  notes: string | null;
  createdById: string | null;
  createdAt: string;
}

export interface CustomerDetail extends Customer {
  loyaltyTransactions: LoyaltyTransaction[];
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
  getMenuItems: (params?: { category?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (params?.category) qs.set('category', params.category);
    if (params?.search) qs.set('search', params.search);
    const tail = qs.toString();
    return request<{ data: MenuItem[] }>(`/api/menu/items${tail ? `?${tail}` : ''}`);
  },
  // Sprint 8.11 — barcode lookup (used by handheld / Bluetooth scanners).
  // The route is /api/menu/items/by-barcode/:barcode. We percent-encode
  // the barcode in case it contains characters like `/` or whitespace.
  getMenuItemByBarcode: (barcode: string) =>
    request<{ data: MenuItem }>(
      `/api/menu/items/by-barcode/${encodeURIComponent(barcode)}`,
    ),
  createMenuItem: (payload: any) =>
    request<{ data: MenuItem }>('/api/menu/items', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateMenuItem: (id: string, payload: any) =>
    request<{ data: MenuItem }>(`/api/menu/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  // Sprint 12 — Recipe management. Replaces the full recipe list for
  // a menu item. Used by the menu-edit dialog's "Ingredients" tab.
  // `recipes: []` clears all ingredients.
  replaceMenuItemRecipes: (
    id: string,
    recipes: Array<{ inventoryItemId: string; quantity: number; unit: string }>,
  ) =>
    request<{ data: { menuItemId: string; recipes: any[] } }>(
      `/api/menu/items/${id}/recipes`,
      { method: 'PUT', body: JSON.stringify({ recipes }) },
    ),
  getMenuItemRecipes: (id: string) =>
    request<{ data: any[] }>(`/api/menu/items/${id}/recipes`),

  // Inventory items
  getInventoryItems: () =>
    request<{ data: InventoryItem[] }>('/api/inventory'),
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
  listShifts: (params?: { from?: string; to?: string; status?: 'OPEN' | 'CLOSED' }) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    if (params?.status) qs.set('status', params.status);
    const q = qs.toString();
    return request<{ data: Shift[] }>(`/api/shifts${q ? `?${q}` : ''}`);
  },
  getShift: (id: string) =>
    request<{
      data: Shift & {
        orders: Array<{
          id: string;
          orderNumber: string;
          status: string;
          type: string;
          totalCents: number;
          openedAt: string;
          closedAt: string | null;
          items: Array<{ id: string; name: string; quantity: number; totalCents: number }>;
          payments: Array<{ id: string; method: string; amountCents: number; createdAt: string }>;
        }>;
      };
    }>(`/api/shifts/${id}`),

  // Orders
  createOrder: (payload: {
    orderType: OrderType;
    items: { menuItemId: string; quantity: number; modifiers?: { modifierId: string }[]; notes?: string }[];
    tableNumber?: string | null;
    customerName?: string | null;
    customerId?: string | null;
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

  // Sprint 8.6 — Combos (set meals)
  listCombos: (params?: { includeInactive?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.includeInactive) q.set('includeInactive', 'true');
    const qs = q.toString();
    return request<{ data: Combo[] }>(`/api/combos${qs ? `?${qs}` : ''}`);
  },
  getComboPrice: (id: string) =>
    request<{ data: ComboPriceBreakdown }>(`/api/combos/${id}/price`),
  createCombo: (payload: {
    name: string;
    description?: string;
    priceCents: number;
    imageUrl?: string;
    validFrom?: string;
    validUntil?: string;
    isActive?: boolean;
    items: Array<{
      menuItemId: string;
      quantity: number;
      overridesPriceCents?: number | null;
    }>;
  }) =>
    request<{ data: Combo }>('/api/combos', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCombo: (
    id: string,
    payload: Partial<{
      name: string;
      description: string;
      priceCents: number;
      imageUrl: string;
      validFrom: string | null;
      validUntil: string | null;
      isActive: boolean;
      items: Array<{
        menuItemId: string;
        quantity: number;
        overridesPriceCents?: number | null;
      }>;
    }>,
  ) =>
    request<{ data: Combo }>(`/api/combos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteCombo: (id: string) =>
    request<{ data: Combo }>(`/api/combos/${id}`, { method: 'DELETE' }),

  // Sprint 8.7 — Promos
  listPromos: (params?: { isActive?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.isActive) q.set('isActive', 'true');
    const qs = q.toString();
    return request<{ data: Promo[] }>(`/api/promos${qs ? `?${qs}` : ''}`);
  },
  validatePromo: (payload: {
    code: string;
    items: Array<{ menuItemId: string; quantity: number; unitPriceCents: number }>;
    memberId?: string;
  }) =>
    request<{ data: PromoValidation }>('/api/promos/validate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  applyPromo: (payload: {
    code: string;
    items: Array<{ menuItemId: string; quantity: number; unitPriceCents: number }>;
    memberId?: string;
    orderId: string;
  }) =>
    request<{ data: { order: Order; promo: PromoValidation } }>('/api/promos/apply', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createPromo: (payload: {
    code: string;
    name: string;
    type: PromoType;
    valueCents?: number;
    percentBp?: number;
    minSubtotalCents?: number;
    maxDiscountCents?: number | null;
    validFrom?: string;
    validUntil: string;
    usageLimit?: number | null;
    isActive?: boolean;
    requiresMember?: boolean;
    conditions?: Array<{
      menuItemId?: string;
      categoryId?: string;
      minQuantity?: number;
    }>;
    rewards: Array<{
      freeMenuItemId?: string;
      freeQuantity?: number;
      discountPercentBp?: number;
      discountCents?: number;
    }>;
  }) =>
    request<{ data: Promo }>('/api/promos', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePromo: (
    id: string,
    payload: Partial<{
      name: string;
      valueCents: number;
      percentBp: number;
      minSubtotalCents: number;
      maxDiscountCents: number | null;
      validFrom: string | null;
      validUntil: string;
      usageLimit: number | null;
      isActive: boolean;
      requiresMember: boolean;
      conditions: Array<{
        menuItemId?: string;
        categoryId?: string;
        minQuantity?: number;
      }>;
      rewards: Array<{
        freeMenuItemId?: string;
        freeQuantity?: number;
        discountPercentBp?: number;
        discountCents?: number;
      }>;
    }>,
  ) =>
    request<{ data: Promo }>(`/api/promos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deletePromo: (id: string) =>
    request<{ data: Promo }>(`/api/promos/${id}`, { method: 'DELETE' }),

  // Sprint 8.8 — Customers / Members
  listCustomers: (params?: { search?: string; includeInactive?: boolean; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set('search', params.search);
    if (params?.includeInactive) q.set('includeInactive', 'true');
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return request<{ data: Customer[] }>(`/api/customers${qs ? `?${qs}` : ''}`);
  },
  getCustomer: (id: string, txLimit?: number) => {
    const q = txLimit ? `?txLimit=${txLimit}` : '';
    return request<{ data: CustomerDetail }>(`/api/customers/${id}${q}`);
  },
  createCustomer: (payload: {
    name?: string;
    phone?: string;
    email?: string;
    birthday?: string;
    address?: string;
    notes?: string;
  }) =>
    request<{ data: Customer }>('/api/customers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCustomer: (
    id: string,
    payload: Partial<{
      name: string;
      phone: string;
      email: string | null;
      birthday: string | null;
      address: string | null;
      notes: string | null;
      isActive: boolean;
    }>,
  ) =>
    request<{ data: Customer }>(`/api/customers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  lookupCustomer: (phone: string) =>
    request<{ data: Customer | null }>('/api/customers/lookup', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),
  getCustomerBalance: (id: string) =>
    request<{ data: { customerId: string; points: number; updatedAt: string | null } }>(
      `/api/customers/${id}/balance`,
    ),
  adjustCustomerLoyalty: (id: string, payload: { delta: number; notes: string }) =>
    request<{
      data: { customerId: string; points: number; transactionId: string; newBalance: number };
    }>(`/api/customers/${id}/loyalty`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  redeemCustomerPoints: (id: string, payload: { points: number; orderId?: string; notes?: string }) =>
    request<{
      data: { customerId: string; points: number; discountCents: number; transactionId: string };
    }>(`/api/customers/${id}/redeem`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Sprint 8.9 — Digital receipt (WhatsApp / Email)
  listReceipts: (orderId: string) =>
    request<{
      data: Array<{
        id: string;
        orderId: string;
        channel: 'WHATSAPP' | 'EMAIL' | 'PRINT';
        target: string;
        status: 'PENDING' | 'SENT' | 'FAILED';
        sentAt: string | null;
        failureReason: string | null;
        createdAt: string;
      }>;
    }>(`/api/receipts/${orderId}`),
  sendReceipt: (payload: {
    orderId: string;
    channels: Array<'WHATSAPP' | 'EMAIL' | 'PRINT'>;
    target?: { whatsapp?: string; email?: string };
  }) =>
    request<{
      data: {
        deliveries: Array<{
          id: string;
          channel: 'WHATSAPP' | 'EMAIL' | 'PRINT';
          target: string;
          status: 'PENDING' | 'SENT' | 'FAILED';
          error?: string;
        }>;
      };
    }>('/api/receipts/send', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  previewReceiptText: (orderId: string) =>
    fetch(`${API_URL}/api/receipts/preview/${orderId}?format=text`, {
      credentials: 'include',
    }).then((r) => r.text()),
  previewReceiptHtml: (orderId: string) =>
    fetch(`${API_URL}/api/receipts/preview/${orderId}?format=html`, {
      credentials: 'include',
    }).then((r) => r.text()),

  // Sprint 8.10 — cash drawer kick. The route returns the ESC/POS bytes
  // (base64) plus a hex dump. Most callers will not need the bytes on
  // the client — they can be triggered directly via the printer's BLE
  // characteristic. The API is mainly useful as a "fallback" transport
  // for browsers that can't open Web Serial / Web USB.
  kickCashDrawer: (payload?: { drawerPin?: 2 | 5; onTime?: number; offTime?: number; force?: boolean }) =>
    request<{
      data: {
        bytesBase64: string;
        length: number;
        drawerPin: 2 | 5;
        onTime: number;
        offTime: number;
        hex: string;
      };
    }>('/api/cash-drawer/kick', {
      method: 'POST',
      body: JSON.stringify(payload ?? { force: true }),
    }),
  getCashDrawerInfo: () =>
    request<{
      data: {
        pins: Array<2 | 5>;
        defaultPin: 2 | 5;
        pulseUnitMs: 2;
        defaultOnTime: number;
        defaultOffTime: number;
        minPulse: number;
        maxPulse: number;
        escposSequence: string;
        transportOptions: Array<{ kind: string; label: string }>;
      };
    }>('/api/cash-drawer/info'),

  // ─── Sprint 9.1 — Self-Order Kiosk (PUBLIC) ─────────────────────────────
  // The kiosk page calls these directly via fetch() because the kiosk is
  // a public page and we don't want to bake the API_URL into the kiosk
  // bundle. See apps/web/src/app/kiosk/page.tsx for the fetch wrappers.

  // ─── Sprint 9.2 — Reservations (auth) ──────────────────────────────────
  listReservations: (params?: { date?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.date) q.set('date', params.date);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString();
    return request<{ data: Reservation[] }>(`/api/reservations${qs ? `?${qs}` : ''}`);
  },
  getReservation: (id: string) =>
    request<{ data: Reservation }>(`/api/reservations/${id}`),
  getReservationAvailability: (params: { date: string; partySize: number }) => {
    const q = new URLSearchParams();
    q.set('date', params.date);
    q.set('partySize', String(params.partySize));
    return request<{
      data: {
        date: string;
        partySize: number;
        slotMinutes: number;
        durationMinutes: number;
        slots: string[];
      };
    }>(`/api/reservations/availability?${q.toString()}`);
  },
  createReservation: (payload: {
    customerName: string;
    customerPhone: string;
    partySize: number;
    reservedAt: string;
    durationMinutes?: number;
    tableNumber?: string;
    notes?: string;
    customerId?: string;
  }) =>
    request<{ data: Reservation }>('/api/reservations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateReservation: (id: string, payload: Partial<{
    customerName: string;
    customerPhone: string;
    partySize: number;
    reservedAt: string;
    durationMinutes: number;
    tableNumber: string | null;
    notes: string | null;
  }>) =>
    request<{ data: Reservation }>(`/api/reservations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  seatReservation: (id: string, payload: { tableNumber?: string; orderId?: string } = {}) =>
    request<{ data: Reservation }>(`/api/reservations/${id}/seat`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  cancelReservation: (id: string, reason: string) =>
    request<{ data: Reservation }>(`/api/reservations/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  noShowReservation: (id: string) =>
    request<{ data: Reservation }>(`/api/reservations/${id}/no-show`, {
      method: 'POST',
    }),

  // ─── Sprint 9.3 — Tables (waiter handheld) ─────────────────────────────
  listTables: (params?: { status?: string; includeInactive?: boolean }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.includeInactive) q.set('includeInactive', 'true');
    const qs = q.toString();
    return request<{ data: RestaurantTable[] }>(`/api/tables${qs ? `?${qs}` : ''}`);
  },
  getTable: (id: string) =>
    request<{ data: RestaurantTableDetail }>(`/api/tables/${id}`),
  createTable: (payload: {
    number: string;
    capacity?: number;
    area?: string;
    positionX?: number;
    positionY?: number;
  }) =>
    request<{ data: RestaurantTable }>('/api/tables', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTable: (
    id: string,
    payload: Partial<{
      number: string;
      capacity: number;
      area: string | null;
      positionX: number | null;
      positionY: number | null;
      status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'CLEANING';
      isActive: boolean;
    }>,
  ) =>
    request<{ data: RestaurantTable }>(`/api/tables/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  openTable: (
    id: string,
    payload: {
      partySize: number;
      serverUserId?: string;
      items?: { menuItemId: string; quantity: number; notes?: string }[];
      customerName?: string;
      notes?: string;
    },
  ) =>
    request<{
      data: {
        table: RestaurantTable;
        session: TableSession;
        order: Order;
      };
    }>(`/api/tables/${id}/open`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  closeTable: (id: string) =>
    request<{ data: { table: RestaurantTable; session: TableSession } }>(
      `/api/tables/${id}/close`,
      { method: 'POST' },
    ),
  transferTable: (id: string, toTableId: string) =>
    request<{
      data: { session: TableSession; fromTable: RestaurantTable; toTable: RestaurantTable };
    }>(`/api/tables/${id}/transfer`, {
      method: 'POST',
      body: JSON.stringify({ toTableId }),
    }),

  // ─── Sprint 9.4 — Menu engineering (BCG matrix) ────────────────────────
  createMenuEngineeringSnapshot: (payload: {
    periodStart: string;
    periodEnd: string;
  }) =>
    request<{ data: MenuEngineeringSnapshotDetail }>('/api/menu-engineering/snapshot', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listMenuEngineeringSnapshots: (params?: { limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set('limit', String(params.limit));
    const qs = q.toString();
    return request<{ data: MenuEngineeringSnapshot[] }>(
      `/api/menu-engineering/snapshots${qs ? `?${qs}` : ''}`,
    );
  },
  getMenuEngineeringSnapshot: (id: string) =>
    request<{ data: MenuEngineeringSnapshotDetail }>(
      `/api/menu-engineering/snapshots/${id}`,
    ),

  // Sprint 9.5 — Suppliers
  listSuppliers: (params?: {
    includeInactive?: boolean;
    search?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.includeInactive) q.set('includeInactive', 'true');
    if (params?.search) q.set('search', params.search);
    const qs = q.toString();
    return request<{ data: { suppliers: Supplier[] } }>(
      `/api/suppliers${qs ? `?${qs}` : ''}`,
    );
  },
  createSupplier: (payload: {
    name: string;
    contactName?: string | null;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    notes?: string | null;
    isActive?: boolean;
  }) =>
    request<{ data: { supplier: Supplier } }>('/api/suppliers', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateSupplier: (
    id: string,
    payload: {
      name?: string;
      contactName?: string | null;
      phone?: string | null;
      email?: string | null;
      address?: string | null;
      notes?: string | null;
      isActive?: boolean;
    },
  ) =>
    request<{ data: { supplier: Supplier } }>(`/api/suppliers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // Sprint 9.5 — Purchase Orders
  listPurchaseOrders: (params?: {
    status?: PurchaseOrderStatus;
    supplierId?: string;
  }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.supplierId) q.set('supplierId', params.supplierId);
    const qs = q.toString();
    return request<{ data: { purchaseOrders: PurchaseOrder[] } }>(
      `/api/purchase-orders${qs ? `?${qs}` : ''}`,
    );
  },
  getPurchaseOrder: (id: string) =>
    request<{ data: { purchaseOrder: PurchaseOrderDetail } }>(
      `/api/purchase-orders/${id}`,
    ),
  createPurchaseOrder: (payload: {
    supplierId: string;
    notes?: string | null;
    expectedAt?: string | null;
    items: Array<{
      inventoryItemId: string;
      qtyOrdered: number;
      unitCostCents: number;
      notes?: string | null;
    }>;
  }) =>
    request<{ data: { purchaseOrder: PurchaseOrder } }>(
      '/api/purchase-orders',
      { method: 'POST', body: JSON.stringify(payload) },
    ),
  updatePurchaseOrder: (
    id: string,
    payload: {
      notes?: string | null;
      expectedAt?: string | null;
      items?: Array<{
        inventoryItemId: string;
        qtyOrdered: number;
        unitCostCents: number;
        notes?: string | null;
      }>;
    },
  ) =>
    request<{ data: { purchaseOrder: PurchaseOrder } }>(
      `/api/purchase-orders/${id}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
    ),
  sendPurchaseOrder: (id: string) =>
    request<{ data: { purchaseOrder: PurchaseOrder } }>(
      `/api/purchase-orders/${id}/send`,
      { method: 'POST' },
    ),
  receivePurchaseOrder: (
    id: string,
    items: Array<{ poItemId: string; qtyReceived: number }>,
  ) =>
    request<{ data: { purchaseOrder: PurchaseOrder } }>(
      `/api/purchase-orders/${id}/receive`,
      { method: 'POST', body: JSON.stringify({ items }) },
    ),
  cancelPurchaseOrder: (id: string) =>
    request<{ data: { purchaseOrder: PurchaseOrder } }>(
      `/api/purchase-orders/${id}/cancel`,
      { method: 'POST' },
    ),

  // Sprint 9.6 — Prep Sheets
  generatePrepSheet: (payload: {
    date: string;
    lookbackDays?: number;
    notes?: string | null;
  }) =>
    request<{
      data: PrepSheetDetail;
    }>('/api/prep-sheets/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listPrepSheets: (params?: { date?: string }) => {
    const q = new URLSearchParams();
    if (params?.date) q.set('date', params.date);
    const qs = q.toString();
    return request<{ data: { prepSheets: PrepSheet[] } }>(
      `/api/prep-sheets${qs ? `?${qs}` : ''}`,
    );
  },
  getPrepSheet: (id: string) =>
    request<{ data: PrepSheetDetail }>(`/api/prep-sheets/${id}`),

  // Sprint 9.7 — Accounting export
  // The export endpoints return CSV (text/csv) — not JSON. We expose a
  // separate helper that returns the raw Response so the page can read the
  // blob + Content-Disposition for the file download. We don't wrap it in
  // the JSON envelope.
  downloadAccountingExport: async (
    journalType: 'sales' | 'purchase',
    params: { from: string; to: string; format: 'JURNAL' | 'ACCURATE' | 'MEKARI' | 'GENERIC' },
  ): Promise<Response> => {
    const qs = new URLSearchParams();
    qs.set('from', params.from);
    qs.set('to', params.to);
    qs.set('format', params.format);
    return fetch(
      `${API_URL}/api/accounting-export/${journalType}-journal.csv?${qs.toString()}`,
      { method: 'GET', credentials: 'include' },
    );
  },

  // Sprint 9.9 — Waste tracking
  // Note: this fetches CSV at /api/accounting-export/:type-journal.csv.
  // The fetch wrapper can't parse non-JSON, so we use raw fetch above.
  listWaste: (params?: {
    from?: string;
    to?: string;
    type?: 'FOOD' | 'INGREDIENT' | 'PACKAGING';
    limit?: number;
    includeDeleted?: boolean;
  }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    if (params?.type) q.set('type', params.type);
    if (params?.limit) q.set('limit', String(params.limit));
    if (params?.includeDeleted) q.set('includeDeleted', 'true');
    const qs = q.toString();
    return request<{ data: { entries: WasteEntry[]; count: number } }>(
      `/api/waste${qs ? `?${qs}` : ''}`,
    );
  },
  getWasteSummary: (params: { days?: number }) => {
    const q = new URLSearchParams();
    if (params.days) q.set('days', String(params.days));
    return request<{ data: WasteSummary }>(`/api/waste/summary?${q.toString()}`);
  },
  createWaste: (payload: {
    type: 'FOOD' | 'INGREDIENT' | 'PACKAGING';
    menuItemId?: string | null;
    inventoryItemId?: string | null;
    quantity: number;
    unitCostCents?: number | null;
    totalCostCents?: number | null;
    reason?: string | null;
    notes?: string | null;
    recordedAt?: string | null;
  }) =>
    request<{ data: { entry: WasteEntry } }>('/api/waste', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateWaste: (
    id: string,
    payload: Partial<{
      type: 'FOOD' | 'INGREDIENT' | 'PACKAGING';
      menuItemId: string | null;
      inventoryItemId: string | null;
      quantity: number;
      unitCostCents: number | null;
      totalCostCents: number | null;
      reason: string | null;
      notes: string | null;
      recordedAt: string | null;
    }>,
  ) =>
    request<{ data: { entry: WasteEntry } }>(`/api/waste/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteWaste: (id: string) =>
    request<{ data: { entry: WasteEntry } }>(`/api/waste/${id}`, { method: 'DELETE' }),

  // Sprint 13 — Settings
  listSettings: () =>
    request<{
      data: {
        settings: {
          key: string;
          value: string;
          description: string | null;
          updatedById: string | null;
          updatedAt: string;
          createdAt: string;
        }[];
        known: string[];
      };
    }>('/api/settings'),
  upsertSetting: (key: string, value: string, description?: string | null) =>
    request<{
      data: {
        key: string;
        value: string;
        description: string | null;
        updatedById: string | null;
        updatedAt: string;
      };
    }>(`/api/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value, description }),
    }),
  // Sprint 15 — public business identity. Same shape as getBusiness()
  // (exported below) so callers can use either reference.
  getBusiness: () => request<{ data: BusinessSnapshot }>('/api/business'),
  // Sprint audit — cash transfer log. See api/routes/transfers.ts.
  getCashTransfers: () =>
    request<{ data: { entries: CashTransfer[] } }>('/api/transfers'),
  createCashTransfer: (body: {
    fromAccount: string;
    toAccount: string;
    amountCents: number;
    notes?: string;
  }) =>
    request<{ data: CashTransfer }>('/api/transfers', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// Sprint 15 — public business identity (name, address, footer). Read-only
// from the web; the OWNER writes via upsertSetting above.
export interface BusinessSnapshot {
  name: string;
  address: string;
  footer: string;
}

export { API_URL };

// ─── Sprint 9.2 — Reservation types ────────────────────────────────────────

export type ReservationStatus = 'BOOKED' | 'SEATED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface Reservation {
  id: string;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  partySize: number;
  reservedAt: string;
  durationMinutes: number;
  tableNumber: string | null;
  status: ReservationStatus;
  notes: string | null;
  orderId: string | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Sprint 9.1 — Kiosk public types ───────────────────────────────────────

export interface KioskCartItem {
  id: string;
  menuItemId: string;
  name: string;
  priceCents: number;
  quantity: number;
  notes?: string;
  lineTotalCents: number;
}

export interface KioskCart {
  items: KioskCartItem[];
}

export interface KioskMenuCategory {
  id: string;
  name: string;
  sortOrder: number;
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    priceCents: number;
    imageUrl: string | null;
    categoryId: string;
  }>;
}

export interface KioskMenuResponse {
  categories: KioskMenuCategory[];
}

export interface KioskOrderSummary {
  id: string;
  orderNumber: string;
  type: 'KIOSK';
  status: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  openedAt: string;
  closedAt: string | null;
  items: Array<{
    id: string;
    nameSnapshot: string;
    quantity: number;
    lineTotalCents: number;
  }>;
}

// ─── Sprint 9.3 — Tables (waiter handheld) ───────────────────────────────

export type TableStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'CLEANING';
export type TableSessionStatus = 'OPEN' | 'CLOSED';

export interface RestaurantTable {
  id: string;
  number: string;
  capacity: number;
  area: string | null;
  status: TableStatus;
  positionX: number | null;
  positionY: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  currentSession: TableSession | null;
  currentOrder: Order | null;
}

export interface RestaurantTableDetail extends RestaurantTable {
  sessions: TableSession[];
}

export interface TableSession {
  id: string;
  tableId: string;
  openedAt: string;
  closedAt: string | null;
  orderId: string | null;
  partySize: number;
  serverUserId: string | null;
  status: TableSessionStatus;
  createdAt: string;
}

// ─── Sprint 9.4 — Menu engineering (BCG matrix) ──────────────────────────

export type MenuEngineeringQuadrant = 'STAR' | 'PLOWHORSE' | 'PUZZLE' | 'DOG';

export interface MenuEngineeringItem {
  menuItemId: string;
  name: string;
  totalQty: number;
  totalRevenueCents: number;
  totalCostCents: number;
  marginCents: number;
  popularityPct: number;
  marginPct: number;
  quadrant: MenuEngineeringQuadrant;
}

export interface MenuEngineeringTotals {
  totalOrders: number;
  totalItems: number;
  totalRevenueCents: number;
  totalCostCents: number;
  totalMarginCents: number;
  medianPopularityPct: number;
  medianMarginPct: number;
  itemCount: number;
}

export interface MenuEngineeringSnapshot {
  id: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  createdById: string | null;
  itemsJson: MenuEngineeringItem[];
  totalsJson: MenuEngineeringTotals;
}

export interface MenuEngineeringSnapshotDetail extends MenuEngineeringSnapshot {
  items: MenuEngineeringItem[];
  totals: MenuEngineeringTotals;
}

// ─── Sprint 9.5 — Suppliers & Purchase Orders ──────────────────────────────

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type PurchaseOrderStatus =
  | 'DRAFT'
  | 'SENT'
  | 'PARTIAL'
  | 'RECEIVED'
  | 'CANCELLED';

export interface PurchaseOrderItem {
  id: string;
  purchaseOrderId: string;
  inventoryItemId: string;
  // qtyOrdered comes back as a number after the API coerces the String
  // column; older code can still pass a number on input.
  qtyOrdered: number;
  qtyReceived: number;
  unitCostCents: number;
  notes: string | null;
  // Server-enriched inventory item summary (detail view)
  inventoryItem?: {
    id: string;
    sku: string;
    name: string;
    unit: string;
    costPerUnit: string | number;
  } | null;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  // API serializes BigInt as string
  subtotalCents: string;
  totalCents: string;
  status: PurchaseOrderStatus;
  expectedAt: string | null;
  notes: string | null;
  createdById: string;
  approvedById: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Optional relations (detail view includes more; list view uses lighter ones)
  supplier?: {
    id: string;
    name: string;
    contactName?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  createdBy?: { id: string; name: string } | null;
  approvedBy?: { id: string; name: string } | null;
  items?: PurchaseOrderItem[];
  _count?: { items: number };
}

export interface PurchaseOrderDetail extends PurchaseOrder {
  items: PurchaseOrderItem[];
  supplier: NonNullable<PurchaseOrder['supplier']>;
}

// ─── Sprint 9.6 — Prep Sheets ─────────────────────────────────────────────

export interface PrepSheetItem {
  menuItemId: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  avgQtyPerDay: number;
  dayOfWeekFactor: number;
  recommendedQty: number;
  last7DayQty: number;
}

export interface PrepSheet {
  id: string;
  date: string;
  lookbackDays: number;
  generatedAt: string;
  generatedById: string;
  notes: string | null;
  // The API returns itemsJson as an opaque Json — we keep it loosely typed
  // so the same shape works whether or not the detail view is requested.
  itemsJson: PrepSheetItem[] | unknown;
}

export interface PrepSheetDetail extends PrepSheet {
  itemsJson: PrepSheetItem[];
  items: PrepSheetItem[];
}

// ─── Sprint 9.7 — Accounting export types ─────────────────────────────────

export type AccountingFormat = 'JURNAL' | 'ACCURATE' | 'MEKARI' | 'GENERIC';
export type AccountingJournalType = 'sales' | 'purchase';

// ─── Sprint audit — Cash transfer log ───────────────────────────────────
export interface CashTransfer {
  id: string;
  at: string;
  byUserId: string;
  byName: string;
  fromAccount: string;
  toAccount: string;
  amountCents: number;
  notes: string;
}

// ─── Sprint 9.9 — Waste tracking types ────────────────────────────────────

export type WasteType = 'FOOD' | 'INGREDIENT' | 'PACKAGING';
export type WasteStatus = 'ACTIVE' | 'DELETED';

export interface WasteEntry {
  id: string;
  type: WasteType;
  status: WasteStatus;
  menuItemId: string | null;
  inventoryItemId: string | null;
  // Prisma Decimal → string in the JSON
  quantity: string;
  unitCostCents: number | null;
  totalCostCents: number | null;
  reason: string | null;
  recordedById: string;
  recordedAt: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  // Server-enriched on list responses
  recordedBy?: { id: string; name: string; role: string } | null;
  menuItem?: { id: string; name: string; sku: string } | null;
  inventoryItem?: { id: string; name: string; sku: string; unit: string } | null;
}

export interface WasteSummaryByType {
  count: number;
  costCents: number;
}

export interface WasteSummaryTopItem {
  key: string;
  name: string;
  type: WasteType;
  count: number;
  costCents: number;
}

export interface WasteSummaryByReason {
  reason: string;
  count: number;
  costCents: number;
}

export interface WasteSummary {
  periodDays: number;
  from: string;
  to: string;
  totalCount: number;
  totalCostCents: number;
  byType: { FOOD: WasteSummaryByType; INGREDIENT: WasteSummaryByType; PACKAGING: WasteSummaryByType };
  topItems: WasteSummaryTopItem[];
  byReason: WasteSummaryByReason[];
}

