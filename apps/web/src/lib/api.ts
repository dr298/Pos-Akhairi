// Typed API client for pos.akhairi.com backend.
// Server runs on http://localhost:8787 (configurable via NEXT_PUBLIC_API_URL).
// All requests send credentials so the pos_session cookie flows through.

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== 'undefined' ? 'http://localhost:8787' : 'http://localhost:8787');

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

export type Role = 'OWNER' | 'MANAGER' | 'CASHIER';

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

export type OrderType = 'DINE_IN' | 'TAKEOUT' | 'DELIVERY';
export type OrderStatus = 'OPEN' | 'PAID' | 'VOIDED' | 'REFUNDED';

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
  }) =>
    request<{ data: Order }>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  payCash: (orderId: string, amountGiven: number) =>
    request<{ data: { order: Order; payment: OrderPayment } }>(
      `/api/orders/${orderId}/pay-cash`,
      { method: 'POST', body: JSON.stringify({ amountGiven }) },
    ),
  getOrders: () => request<{ data: Order[] }>('/api/orders'),
  getOrder: (id: string) => request<{ data: Order }>(`/api/orders/${id}`),

  // Reports
  getDailyReport: (date: string) =>
    request<{ data: unknown }>(`/api/reports/daily?date=${encodeURIComponent(date)}`),
};

export { API_URL };
