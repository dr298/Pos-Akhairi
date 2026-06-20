# pos.akhairi.com — API Reference

Sprint 7 documentation. All routes mounted under the Hono 4 API base.
Base URL (production): `https://pos.akhairi.com`
Base URL (local dev): `http://localhost:8787`

All authenticated routes require an HttpOnly cookie `pos_session` (set by
`POST /api/auth/login`). Cross-origin requests must include credentials.

Every response includes an `X-Request-Id` header — pass it to support when
reporting issues. Unhandled errors are persisted to the `error_events` table
(OWNER-accessible via `GET /api/errors`).

---

## Auth (`/api/auth`)

### `POST /api/auth/login`
Rate-limited: 20 attempts / minute / IP.
```json
{ "email": "owner@bkj.id", "password": "password123" }
```
Returns: `{ user: { id, email, name, role, branchId, branch } }`
Sets cookie: `pos_session` (HttpOnly, SameSite=Lax, 7d).

### `POST /api/auth/logout`
Clears the `pos_session` cookie. Always 200.

### `GET /api/auth/me`
Returns current user (incl. branch access list). Used by AuthProvider on every page.

### `POST /api/auth/me/branch`
Switch active branch. Body: `{ branchId: "cusks5ank6bkavx8mmacqg1er" }`.
Sets cookie `pos_branch`. Affects all subsequent reads (menu, orders, etc.).

### `POST /api/auth/refresh` *(legacy)*
Rate-limited: 20/min. Re-issues session cookie if valid.

---

## Menu (`/api/menu`)

### `GET /api/menu/categories`
Returns all menu categories for the active branch.

### `GET /api/menu/items?branchId=X&category=Y&search=Z`
Returns menu items. `branchId` defaults to user's effective branch.

### `POST /api/menu/items` *(OWNER, MANAGER)*
Create menu item. Body: `{ name, priceCents, categoryId, description?, taxRateBp?, useBranchPpn? }`.

### `PATCH /api/menu/items/:id` *(OWNER, MANAGER)*
Update price/name/etc. Useful for per-branch price adjustment.

### `POST /api/menu/clone` *(OWNER, MANAGER)*
**Sprint 5.4** — Bulk-copy menu from one branch to another.
```json
{
  "fromBranchId": "cmqlvwrtb00008c1k6vif6268",
  "toBranchId": "cusks5ank6bkavx8mmacqg1er",
  "categoryMap": { "oldCatId": "newCatId" },
  "priceOverrides": { "menuItemIdA": 30000, "menuItemIdB": 32000 },
  "skipExisting": true
}
```
Returns: `{ created: 8, skipped: 2, errors: [] }`

---

## Orders (`/api/orders`)

All routes require auth. Branch scoped via effective branch.

### `POST /api/orders`
Create new order. Body:
```json
{
  "type": "DINE_IN" | "TAKEAWAY" | "DELIVERY",
  "tableNumber": "12",  // optional
  "customerName": "...",
  "items": [{ "menuItemId": "...", "quantity": 2, "notes": "...", "modifiersJson": [...] }],
  "discountCode": "PROMO10",  // optional
  "channelOrderId": "...",  // for aggregator orders
  "externalRef": "..."  // aggregator's order id
}
```
Returns: `{ order: { id, orderNumber, totalCents, status } }`

### `GET /api/orders?status=OPEN&from=2026-06-20&to=2026-06-20&limit=50`
List orders filtered by status/date/branch.

### `GET /api/orders/:id`
Order detail with line items + payment.

### `POST /api/orders/:id/pay-cash`
Finalize CASH payment. Body: `{ amountGiven: 50000 }`.
Returns: `{ order, payment, changeCents, amountGiven, lowStockAlerts }`.
**Sprint 7.5**: increments `pos_payments_completed_total` and observes `pos_payment_latency_ms`.

### `POST /api/orders/:id/pay-midtrans`
Initiate Midtrans Snap payment. Returns: `{ snapToken, redirectUrl }`.

### `POST /api/orders/:id/pay-xendit`
Initiate Xendit invoice. Returns: `{ invoiceId, invoiceUrl, expiry }`.

### `POST /api/orders/:id/void` *(MANAGER, OWNER)*
Void an OPEN order. Body: `{ reason: "wrong items" }`.

### `POST /api/orders/:id/refund` *(OWNER)*
Refund a PAID order. Body: `{ refundMethod: "CASH"|"ORIGINAL", reason: "..." }`.

### `POST /api/orders/:id/discount`
Apply discount code. Body: `{ code: "PROMO10" }`.

---

## Shifts (`/api/shifts`)

### `GET /api/shifts/current`
Returns the user's currently-open shift (or null).

### `POST /api/shifts/open`
Body: `{ openingCash: 100000 }`. Returns shift record.

### `POST /api/shifts/:id/close`
Body: `{ actualClosingCash: 250000, notes: "..." }`. Returns shift with variance.

---

## Reports (`/api/reports`)

### `GET /api/reports/z-report?date=2026-06-20`
**Sprint 5.7** — Full Z-report for a business date at the active branch.
Returns:
```json
{
  "date": "2026-06-20",
  "branchId": "...",
  "summary": {
    "grossSalesCents": 1234000,
    "netSalesCents": 1112000,
    "taxCents": 122000,
    "discountCents": 0,
    "voidCents": 0,
    "refundCents": 0,
    "orderCount": 42,
    "paidCount": 40,
    "voidCount": 1,
    "refundCount": 1
  },
  "byPayment": [{ "method": "CASH", "count": 38, "amountCents": 1120000 }, ...],
  "byOrderType": [...],
  "byChannel": [...],
  "byCategory": [...],
  "byHour": [{ "hour": 8, "count": 2, "amountCents": 50000 }, ...],
  "topItems": [{ "menuItemId": "...", "name": "Bakmie Ayam", "qtySold": 38, "revenueCents": 1064000 }, ...],
  "shifts": [...],
  "voidLog": [...],
  "refundLog": [...]
}
```

### `GET /api/reports/z-report/export.csv?date=2026-06-20`
Same data, CSV format for accountant/spreadsheet.

### `GET /api/reports/chain-summary?days=7`
**Sprint 5.3** — Cross-branch HQ dashboard data.

---

## Channels (`/api/channels`)

Delivery aggregator config + management. Sprint 3.

### `GET /api/channels`
List all configured channels (GoFood, GrabFood, ShopeeFood).

### `PUT /api/channels/:channel` *(OWNER)*
Upsert channel config. Body: `{ enabled, apiKey, apiSecret, storeId, webhookSecret }`.
Secrets encrypted at rest (AES-256-GCM).

### `POST /api/channels/:channel/test`
Test OAuth connection to the aggregator.

### `POST /api/channels/:channel/poll`
Manual trigger of order polling for this channel.

### `POST /api/channels/:channel/menu-sync`
Push current menu + per-item availability to aggregator.

### `DELETE /api/channels/:channel`
Remove channel config.

### `GET /api/channel-orders?status=PENDING&channel=GOFOOD&limit=50`
List incoming aggregator orders.

### `POST /api/channel-orders/:id/accept`
Convert aggregator order to local Order.

### `POST /api/channel-orders/:id/reject`
Reject with reason.

### `POST /api/channel-orders/:id/status`
Update order status: `PREPARING` | `READY` | `PICKED_UP` | `DELIVERED` | `CANCELLED`.

### `GET /api/channel-analytics/summary?days=7`
Aggregator performance: orders, revenue, commission, on-time rate.

---

## Branches (`/api/branches`)

### `GET /api/branches`
List branches the user has access to (via UserBranchAccess).

### `GET /api/branches/:id`
Branch detail. Returns 403 if user has no access.

### `PATCH /api/branches/:id` *(OWNER)*
Update branch info: name, address, city, phone.

### `PATCH /api/branches/:id/ppn` *(OWNER)*
**Sprint 5.6** — Set branch PPN. Body:
```json
{ "ppnPercent": 1100, "ppnInclusive": false }
```
- `ppnPercent` is basis points: 1100 = 11%, 0 = no PPN
- `ppnInclusive=true` means tax is INCLUDED in displayed prices

---

## Transfers (`/api/transfers`) — Sprint 5.2

### `GET /api/transfers?status=PENDING&fromBranch=X&toBranch=Y`
List stock transfers with filters.

### `GET /api/transfers/inventory/:branchId`
Get inventory items + stock for source branch (used when creating a transfer).

### `POST /api/transfers` *(MANAGER, OWNER)*
Create transfer. Body:
```json
{
  "fromBranchId": "...",
  "toBranchId": "...",
  "notes": "Restock mingguan",
  "items": [{ "inventoryItemId": "...", "qtyTransferred": 50, "costCents": 15000 }]
}
```

### `POST /api/transfers/:id/send`
Mark transfer as IN_TRANSIT (subtracts qty from source).

### `POST /api/transfers/:id/receive`
Body: `{ receivedItems: [{ "itemId": "...", "qtyReceived": 50 }] }`.
Adds qty to destination.

### `POST /api/transfers/:id/cancel`
Cancel a PENDING transfer.

---

## Errors (`/api/errors`) — Sprint 7.2 (self-hosted Sentry alt)

### `GET /api/errors?severity=ERROR&route=/api/orders&limit=50&since=2026-06-20T00:00:00Z` *(OWNER)*
List recent error events with filters. Returns:
```json
{
  "data": {
    "items": [{ "id": "...", "severity": "ERROR", "route": "POST /api/orders", "message": "...", "stack": "...", "requestId": "...", "userId": "...", "branchId": "...", "createdAt": "..." }],
    "total": 42,
    "summary": { "bySeverity": [...], "topRoutes": [...] }
  }
}
```

### `GET /api/errors/stats` *(OWNER)*
24h + 7d counts, severity breakdown.

---

## Metrics (`/api/metrics`) — Sprint 7.5

Prometheus text format. Public (no auth) for scraping.

```
# HELP pos_orders_created_total Total orders created
# TYPE pos_orders_created_total counter
pos_orders_created_total{branchId="cmqlvwrtb...",type="DINE_IN"} 42

# HELP pos_payment_latency_ms Time from order open to paid
# TYPE pos_payment_latency_ms histogram
...
```

Exposed metrics:
- `http_requests_total{method,route,status}` — request count
- `http_request_duration_seconds{method,route,status}` — request latency
- `pos_orders_created_total{branchId,type}` — business KPI
- `pos_order_subtotal_cents` (histogram) — order size distribution
- `pos_payments_completed_total{branchId,method}` — payment count
- `pos_payment_latency_ms` (histogram) — order → paid duration

---

## Health (`/api/health`, `/api/ready`)

### `GET /api/health`
Basic info: service name, version, uptime. Always 200.

### `GET /api/ready`
Probes DB with 2s timeout. Returns 503 if down.
Used by Docker/orchestrator for readiness gating.

### `GET /api/live`
Process liveness. No dependencies probed.

---

## Webhooks (`/api/webhooks/:channel`)

Public endpoints for aggregator callbacks. HMAC-verified.
- `POST /api/webhooks/gofood` — GoFood order/payment updates
- `POST /api/webhooks/grabfood` — GrabFood
- `POST /api/webhooks/shopeefood` — ShopeeFood

Signature verification differs per channel — see `apps/api/src/channels/`.

---

## Error codes

| Code | HTTP | Meaning |
|------|------|---------|
| `InvalidCredentials` | 401 | Bad email/password |
| `Unauthenticated` | 401 | Missing/expired session |
| `Forbidden` | 403 | Role/branch access denied |
| `NotFound` | 404 | Resource not found |
| `ValidationError` | 400 | Request body fails Zod schema |
| `OrderClosed` | 409 | Order already PAID/VOIDED/REFUNDED |
| `OrderNotVoidable` | 409 | Can only void OPEN orders |
| `OrderNotRefundable` | 409 | Can only refund PAID orders |
| `FinalizeFailed` | 500 | Payment finalization failed |
| `TooManyRequests` | 429 | Rate limit exceeded |
| `Internal Server Error` | 500 | Unhandled — see error_events |

---

## Rate limits

| Scope | Limit | Window |
|-------|-------|--------|
| All API | 300 req | 1 min / IP |
| `/api/auth/login` | 20 req | 1 min / IP |
| `/api/auth/refresh` | 20 req | 1 min / IP |

IP detection: `CF-Connecting-IP` (Cloudflare) > `X-Forwarded-For` > `X-Real-IP` > `unknown`.
