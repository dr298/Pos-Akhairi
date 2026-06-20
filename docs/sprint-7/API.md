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
  "discountCode": "PROMO10",       // optional (legacy Discount)
  "promoCode": "HEMAT20",          // optional (Sprint 8.7 Promo engine)
  "comboItems": [{                 // optional (Sprint 8.6 Combo / set meal)
    "comboId": "...",
    "quantity": 1,
    "notes": "less ice"
  }],
  "channelOrderId": "...",  // for aggregator orders
  "externalRef": "..."  // aggregator's order id
}
```
At least one of `items` or `comboItems` must be present. Combo items are
expanded into line items priced at `combo.priceCents`. The legacy
`discountCode` and the new `promoCode` are mutually exclusive — if both are
present, the legacy discount wins and the promo is skipped (logged).
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

## Combos (`/api/combos`) — Sprint 8.6

Set meal bundles. A combo is a fixed-price bundle of menu items.

### `GET /api/combos?branchId=X&includeInactive=true`
List combos for a branch. Cashiers see only active ones by default.
Each combo includes its `items[]` (ComboItem rows).

### `GET /api/combos/:id/price`
Compute combo price breakdown. Returns:
```json
{
  "comboId": "...",
  "comboName": "Paket A",
  "comboPriceCents": 35000,
  "itemsTotalCents": 42000,    // sum of items using overrides
  "savingsCents": 7000,
  "items": [
    { "menuItemId": "...", "name": "Nasi Goreng", "quantity": 1, "unitPriceCents": 25000, "lineTotalCents": 25000 }
  ]
}
```

### `POST /api/combos` *(OWNER, MANAGER)*
Create combo. Body:
```json
{
  "name": "Paket A",
  "description": "Nasi Goreng + Es Teh",
  "priceCents": 35000,
  "imageUrl": "https://...",
  "validFrom": "2026-06-20T00:00:00Z",
  "validUntil": "2026-07-20T23:59:59Z",
  "isActive": true,
  "items": [
    { "menuItemId": "...", "quantity": 1, "overridesPriceCents": null },
    { "menuItemId": "...", "quantity": 1, "overridesPriceCents": 8000 }
  ]
}
```
- `priceCents` is the set price (what the customer pays). Use 0 to sell at
  the sum of items.
- `overridesPriceCents` is optional per-item price override (e.g. upgrades).

### `PATCH /api/combos/:id` *(OWNER, MANAGER)*
Partial update. Pass `items: [...]` to replace all items atomically.

### `DELETE /api/combos/:id` *(OWNER)*
Soft delete (`isActive=false`).

### Usage in `POST /api/orders`
Pass `comboItems: [{comboId, quantity, notes?}]` along with or instead of
regular `items`. Each combo expands into a line item at the combo's
set price.

---

## Promos (`/api/promos`) — Sprint 8.7

Flexible discount engine. A `Promo` has conditions (must all be satisfied)
and rewards (applied when conditions are met). Four types:
`PERCENT` | `AMOUNT` | `BUY_X_GET_Y` | `BUNDLE`.

### `GET /api/promos?branchId=X&isActive=true`
List promos. Cashiers see only active by default. Includes
`conditions[]` and `rewards[]`.

### `POST /api/promos` *(OWNER, MANAGER)*
Create promo. Body:
```json
{
  "code": "HEMAT20",
  "name": "Diskon Akhir Pekan",
  "type": "PERCENT",
  "percentBp": 2000,             // 20% (basis points)
  "minSubtotalCents": 50000,
  "maxDiscountCents": 30000,
  "validFrom": "2026-06-20T00:00:00Z",
  "validUntil": "2026-07-20T23:59:59Z",
  "usageLimit": 100,
  "isActive": true,
  "requiresMember": false,
  "conditions": [
    { "menuItemId": "...", "minQuantity": 1 }
  ],
  "rewards": [
    { "discountPercentBp": 2000 }
  ]
}
```
- For `AMOUNT` type use `valueCents` (in cents) instead of `percentBp`.
- For `BUY_X_GET_Y`/`BUNDLE` types, the value field is unused — the
  reward rows define what the customer gets (free items, % off, Rp off).
- Each `condition` ANDs together. Pass empty array for "any order".
- Each `reward` adds to the total discount / free items.

### `PATCH /api/promos/:id` *(OWNER, MANAGER)*
Partial update. Pass `conditions: [...]` or `rewards: [...]` to replace
all rows of that type atomically.

### `DELETE /api/promos/:id` *(OWNER)*
Soft delete (`isActive=false`).

### `POST /api/promos/validate`
Pure validation (no DB mutation). Body:
```json
{
  "code": "HEMAT20",
  "branchId": "...",          // optional — uses user's branch if omitted
  "items": [
    { "menuItemId": "...", "quantity": 1, "unitPriceCents": 50000 }
  ],
  "memberId": "..."           // optional
}
```
Returns:
```json
{
  "valid": true,
  "promoId": "...",
  "name": "Diskon Akhir Pekan",
  "discountCents": 10000,
  "freeItems": [
    { "menuItemId": "...", "name": "Es Teh", "quantity": 1 }
  ]
}
```
If invalid: `{ "valid": false, "discountCents": 0, "freeItems": [], "reason": "..." }`.

### `POST /api/promos/apply` *(CASHIER, MANAGER, OWNER)*
Apply a promo to an existing OPEN order. Same body as `validate` plus
`orderId`. Decrements `usageCount`, sets `order.discountCents` and
`order.totalCents`. Returns `{ order, promo: { valid, discountCents, ... } }`.

### Usage in `POST /api/orders`
Pass `promoCode: "HEMAT20"` to apply during order creation. The promo is
validated against the order's line items; `usedCount` is incremented.
Mutually exclusive with legacy `discountCode` (legacy wins if both passed).

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

## Customers / Loyalty (`/api/customers`) — Sprint 8.8

Membership + loyalty points program. Customers are scoped to a branch
(when `branchId` is set) or chain-wide (when `branchId` is null). Loyalty
is branch-configured via `LoyaltyConfig` (one row per branch, created
lazily on first access). All loyalty side-effects from order payment
are best-effort — an order is never blocked or rolled back because of
a loyalty failure.

### Earn formula
```
points = floor((order.totalCents / 100) * pointsPerRupiah)
```
Default: 1 point per Rp 100 of paid amount (`pointsPerRupiah=1`).

### Redeem formula
```
discountCents = points * rupiahPerPoint
```
Default: 1 point = Rp 100 of discount (`rupiahPerPoint=100`). Subject
to `minRedeemPoints` (default 100).

### `GET /api/customers?branchId=X&search=Q&limit=50`
List customers. `search` matches name, phone (normalized), or email
(case-insensitive). Scoped to user's effective branch by default.
Returns latest-active first.

### `GET /api/customers/:id`
Customer detail. Includes `loyaltyTransactions[]` (latest 50 by default;
pass `?txLimit=200` to widen).

### `POST /api/customers` *(CASHIER+)*
Create customer. Body:
```json
{
  "name": "Budi Santoso",       // optional
  "phone": "08123456789",       // one of phone|email required
  "email": "budi@email.com",    // one of phone|email required
  "birthday": "1990-05-15",     // optional ISO date
  "address": "Jakarta",         // optional
  "notes": "Pelanggan VIP",     // optional
  "branchId": "..."             // optional; defaults to user's branch
}
```
If a customer with the same phone/email already exists in the same
scope, returns 200 with the existing record (idempotent). If the
branch's `LoyaltyConfig` grants a `signupBonusPoints`, the bonus is
credited automatically and a `BONUS` `LoyaltyTransaction` is written.

### `PATCH /api/customers/:id` *(CASHIER+)*
Partial update. Pass `isActive: false` to soft-delete.

### `POST /api/customers/:id/loyalty` *(OWNER, MANAGER)*
Manual point adjustment. Body: `{ delta: 50, notes: "koreksi" }`.
Negative delta reduces the balance. Refuses to take the balance below
zero. Writes an `ADJUST` `LoyaltyTransaction`.

### `GET /api/customers/:id/balance`
Returns `{ customerId, points, updatedAt }`. Cheap (no joins).

### `POST /api/customers/lookup`
Fast POS-side member lookup by phone. Body: `{ phone: "0812..." }`.
Returns the customer (or `null` if not found) — no auth role guard
needed beyond standard `requireAuth`.

### `POST /api/customers/:id/redeem` *(CASHIER+)*
Convert points to a discount. Body:
```json
{ "points": 200, "orderId": "..." }
```
Returns:
```json
{ "customerId": "...", "points": 200, "discountCents": 20000, "transactionId": "..." }
```
The caller is responsible for applying `discountCents` to the
order. Throws 400 on insufficient balance or below `minRedeemPoints`.

### Loyalty in `POST /api/orders`
Pass `customerId: "..."` on order creation to attach a member. On
payment (`pay-cash` / `pay-midtrans` / `pay-xendit`), the order's
`totalCents` is converted to points and credited to the customer
automatically. Loyalty failure is non-fatal — the order is still
considered paid and the failure is logged at WARN level.

---

## Digital Receipts (`/api/receipts`) — Sprint 8.9

Digital receipt delivery via WhatsApp (Meta Cloud API) and Email
(SMTP / nodemailer). Each delivery attempt is persisted in the
`receipt_deliveries` table for delivery history + retry.

Configuration (env):
- WhatsApp: `WA_API_URL`, `WA_API_TOKEN`
- Email: `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

If a provider is unconfigured, the row is recorded as `FAILED` with
reason `"WhatsApp not configured"` / `"SMTP not configured"` — the API
never crashes. Channels are dispatched fire-and-forget; the route awaits
all of them and returns the created rows.

### Indonesian receipt text format
```
=== BAKMIE KOTA JUANG ===
[Branch name]
[Address]

No. Order: ORD-20251220-0001
Tanggal:   20/12/2025 14:30
Kasir:     Budi
Meja:      5
Pelanggan: Andi

---------------------------------
Bakmie Ayam                2  Rp 50.000
Es Teh                     2  Rp 20.000
---------------------------------
Subtotal:                Rp 100.000
PPN 11%:                 Rp  11.000
Diskon:                  Rp   0
---------------------------------
TOTAL:                   Rp 111.000

Bayar (Tunai):           Rp 120.000
Diterima:                Rp 120.000
Kembali:                 Rp   9.000

Terima kasih atas kunjungannya!
```

### `GET /api/receipts/:orderId`
List all delivery attempts for an order. Returns up to 100 rows
ordered by `createdAt desc`. Each row:
```json
{
  "id": "...",
  "orderId": "...",
  "channel": "WHATSAPP" | "EMAIL" | "PRINT",
  "target": "+6281234567890",
  "status": "PENDING" | "SENT" | "FAILED",
  "sentAt": "2025-12-20T07:30:00Z" | null,
  "failureReason": null | "WhatsApp not configured",
  "payloadJson": null | { ... },
  "createdAt": "..."
}
```

### `POST /api/receipts/send` *(CASHIER+)*
Trigger delivery. Body:
```json
{
  "orderId": "...",
  "channels": ["WHATSAPP", "EMAIL"],
  "target": {                    // optional — falls back to customer phone/email
    "whatsapp": "+6281234567890",
    "email": "andi@email.com"
  }
}
```
- `channels` must contain at least one entry.
- When the order has `customerId` set and the customer has phone/email,
  the delivery hook in `payment-finalize.ts` will have already created
  a row on payment. This endpoint is for re-sends or sending via a
  channel the cashier chooses manually.
- Response: `{ deliveries: [{ id, channel, target, status, error? }] }`

### `GET /api/receipts/preview/:orderId?format=text|html`
Render the receipt as plain text (default) or HTML. The HTML body is
the same template used for emails; the text body matches the WhatsApp
format shown above. No PDF library is required for Sprint 8.9.

### Auto-send on payment
When an order is finalized via `pay-cash` / `pay-midtrans` / `pay-xendit`,
the payment-finalize service checks the order's customer (if any) and
attempts fire-and-forget delivery via WhatsApp (if phone) and/or Email
(if email). Failures are non-fatal — they only land on
`ReceiptDelivery` rows; the order is still considered paid. The
cashier can always re-send from `/pos/orders/:id/receipt`.

---

## Cash Drawer (`/api/cash-drawer`) — Sprint 8.10

Cash drawer integration. The dominant wiring: the drawer is plugged
into the thermal printer's RJ12 port. Opening the drawer is done by
emitting an ESC/POS pulse command (`ESC p <pin> <onTime> <offTime>`)
on the print line, which the printer routes to the RJ12 connector.

Default bytes: `\x1B \x70 \x00 \x19 \x19` (pin 2, 25 × 2ms on, 25 ×
2ms off) — the universal values that work on every printer we've
shipped to. Pin 5 is offered for APG / MMF drawers.

On the web side, the actual byte emission is in
`apps/web/src/lib/escpos.ts` (`buildReceipt` prepends the kick
automatically for CASH payments) and the BLE/Serial/USB transports
are in `apps/web/src/lib/cash-drawer.ts`. The API below is mainly
useful for diagnostics + the auto-kick metadata persisted on
`ReceiptDelivery` rows.

### `POST /api/cash-drawer/kick` *(auth)*
Generate the ESC/POS kick bytes. Body (all optional):
```json
{
  "drawerPin": 2,         // 2 (default) or 5
  "onTime": 25,           // 2ms units, 1..255
  "offTime": 25,          // 2ms units, 1..255
  "force": true           // ignore the "cash-only" heuristic
}
```
Response:
```json
{
  "data": {
    "bytesBase64": "G3AZGQ==",
    "length": 5,
    "drawerPin": 2,
    "onTime": 25,
    "offTime": 25,
    "hex": "1B 70 00 19 19"
  }
}
```

### `GET /api/cash-drawer/info`
Static description of the kick options. Used by `/pos/settings/hardware`
to render the dropdown without duplicating constants on the web side.
```json
{
  "data": {
    "pins": [2, 5],
    "defaultPin": 2,
    "pulseUnitMs": 2,
    "defaultOnTime": 25,
    "defaultOffTime": 25,
    "minPulse": 1,
    "maxPulse": 255,
    "escposSequence": "\\x1B \\x70 <pin> <onTime> <offTime>",
    "transportOptions": [
      { "kind": "printer",    "label": "Lewat Printer (RJ12)" },
      { "kind": "webserial",  "label": "Web Serial (USB-to-Serial)" },
      { "kind": "webusb",     "label": "Web USB (langsung)" }
    ]
  }
}
```

### Auto-kick on CASH payment
When an order is paid via `/api/orders/:id/pay-cash`, the cashier
POS page (apps/web/src/app/pos/page.tsx) flips a `drawerKickTrigger`
flag, which the `useDrawerKick()` hook picks up and attempts the
kicks in order: printer BLE → Web Serial → Web USB → API fallback.
Successful local kicks show a "Drawer dibuka" toast. The byte
sequence is also persisted on the `ReceiptDelivery.payloadJson` row
for the PRINT channel so the kick can be replayed manually if needed.

---

## Barcode Scanner (Sprint 8.11)

The barcode scanner integration is **client-side only** — barcode
scanners are HID devices that type the value + Enter into the
focused input, so no server endpoint is needed for the common case.

The `/api/menu/items/by-barcode/:barcode` endpoint is the lookup
that backs the auto-add-to-cart flow when a scan is detected. See
the **Menu** section below for the route.

For Bluetooth scanners configured in non-HID mode, the web side
uses the Web Bluetooth API directly (see
`apps/web/src/lib/barcode-scanner.ts`). The hook exposes
`requestBluetoothScanner()` which opens the device picker.

---

## Menu (Sprint 8.11 additions)

The MenuItem model gained an optional `barcode` field. The barcode
is unique per branch (so two branches can use the same code, but
the same branch can't have two items with one code).

### `GET /api/menu/items/by-barcode/:barcode` *(auth)*
Look up a menu item by barcode in the caller's active branch. Returns
404 if no item matches, or 404 (deliberately) for cashiers if the
matching item is `isActive=false` or `isAvailable=false`.
Optional query: `?branchId=...` (defaults to the user's active branch).
```json
{
  "data": {
    "id": "...",
    "name": "Bakmie Ayam",
    "barcode": "8991001",
    "priceCents": 25000,
    "categoryId": "...",
    "category": { "...": "..." },
    "modifiers": []
  }
}
```

The route is registered **before** `/api/menu/items/:id` so the
static path doesn't get shadowed by the param route.

### Item create / update
The `barcode` field is now part of the `POST /api/menu/items` and
`PATCH /api/menu/items/:id` payloads. A duplicate `barcode` in the
same branch returns `409 BarcodeTaken`:
```json
{
  "error": "BarcodeTaken",
  "message": "Barcode sudah dipakai item lain di branch ini"
}
```

---

## Webhooks (`/api/webhooks/:channel`)

Public endpoints for aggregator callbacks. HMAC-verified.
- `POST /api/webhooks/gofood` — GoFood order/payment updates
- `POST /api/webhooks/grabfood` — GrabFood
- `POST /api/webhooks/shopeefood` — ShopeeFood

Signature verification differs per channel — see `apps/api/src/channels/`.

---

## Kiosk (`/api/kiosk`) — Sprint 9.1

Public endpoints for the self-order kiosk. **No auth required** — the
kiosk hardware is a fullscreen, no-login UI for customers. A kiosk
session is a temporary cart (`KioskSession` row) that is converted to a
real `Order` (type=`KIOSK`, status=`OPEN`) at checkout. The cashier then
scans the QR / types the order number to take payment via the regular
`/api/orders/:id/pay-*` flow.

Sessions expire after 30 min of inactivity and are marked `ABANDONED`.

### `GET /api/kiosk/menu?branchId=X`
Returns the active menu for a branch (categories + items). No auth.
```json
{
  "data": {
    "branch": { "id": "...", "name": "...", "code": "..." },
    "categories": [
      {
        "id": "...",
        "name": "Makanan",
        "items": [
          { "id": "...", "name": "Bakmie Ayam", "priceCents": 25000, "imageUrl": null }
        ]
      }
    ]
  }
}
```

### `POST /api/kiosk/cart`
Create a new kiosk session. Returns the session id and an empty cart.
Body (optional): `{ branchId, items?: [{ menuItemId, quantity, notes? }] }`.
Returns 201 with `{ sessionId, cart, subtotalCents, expiresAt, ttlMinutes }`.

### `GET /api/kiosk/cart/:sessionId`
Read the current cart. 410 if expired, 409 if `CHECKED_OUT` / `ABANDONED`.

### `POST /api/kiosk/cart/:sessionId/items`
Add (or merge with an existing line of the same item) a menu item.
Body: `{ menuItemId, quantity, notes? }`. Refreshes `lastActivityAt`.

### `DELETE /api/kiosk/cart/:sessionId/items/:itemId`
Remove a single line from the cart.

### `POST /api/kiosk/cart/:sessionId/checkout`
Convert the cart to a real `Order` (type=`KIOSK`, status=`OPEN`). The
order's `orderNumber` is prefixed `K-YYYYMMDD-####` so cashiers can
spot kiosk orders at a glance. No shift is attached — the order
floats until the cashier claims it.
Body: empty. Returns:
```json
{
  "data": {
    "orderId": "...",
    "orderNumber": "K-20260620-0001",
    "branchId": "...",
    "subtotalCents": 50000,
    "taxCents": 5500,
    "totalCents": 55500,
    "status": "OPEN",
    "items": [...]
  }
}
```

### `GET /api/kiosk/order/:kioskOrderId`
Poll the order status. The `:kioskOrderId` may be either the order
`id` (cuid) or the `orderNumber` (e.g. `K-20260620-0001`) — the
kiosk status page accepts both so the customer can type a number.
Returns `{ id, orderNumber, status, items, totals, openedAt, closedAt }`.
Status flow: `OPEN → SENT_TO_KDS → IN_PROGRESS → READY → SERVED → PAID`.

### Kiosk error codes
- `SessionExpired` (410) — session TTL passed; mark abandoned
- `SessionClosed` (409) — session already `CHECKED_OUT` or `ABANDONED`
- `EmptyCart` (400) — checkout called with an empty cart
- `MenuItemUnavailable` (409) — cart has an item that is no longer in
  the menu (price/availability changed). The customer must remove the
  stale line.
- `ConfigError` (500) — branch has no OWNER/MANAGER to attribute the
  order to (kiosk checkout requires a real user as `openedBy`).

---

## Reservations (`/api/reservations`) — Sprint 9.2

Table reservations. All routes require auth. Create / update / seat /
cancel / no-show require `CASHIER`+ (any active POS role). List /
detail / availability are read-only.

### `GET /api/reservations?branchId=X&date=YYYY-MM-DD&status=BOOKED`
List reservations. `branchId` defaults to the user's effective branch.
`date` is a single calendar day (Asia/Jakarta, `YYYY-MM-DD`).
`status` optional filter (`BOOKED` | `SEATED` | `COMPLETED` | `CANCELLED` | `NO_SHOW`).
Returns at most 200 rows ordered by `reservedAt`.

### `GET /api/reservations/availability?branchId=X&date=YYYY-MM-DD&partySize=N`
Returns 30-min free slots in `[09:00, 22:00)` local Jakarta. A slot is
free when no existing `BOOKED` / `SEATED` reservation overlaps with
`[slotStart, slotStart + 90m)`. Past slots are filtered out.
```json
{
  "data": {
    "branchId": "...",
    "date": "2026-06-20",
    "partySize": 2,
    "slotMinutes": 30,
    "durationMinutes": 90,
    "slots": ["09:00", "09:30", "10:00", ...]
  }
}
```

### `GET /api/reservations/:id`
Fetch one reservation. 404 if not found.

### `POST /api/reservations` *(CASHIER+)*
Create a reservation. Body:
```json
{
  "branchId": "...",
  "customerName": "Budi",
  "customerPhone": "0812…",
  "partySize": 4,
  "reservedAt": "2026-06-20T19:00:00+07:00",
  "durationMinutes": 90,
  "tableNumber": "VIP-1",
  "notes": "Ulang tahun, minta dekorasi",
  "customerId": "..."
}
```
`customerId` is optional (links to the Customer model if the guest is a
member). Returns 201 with the new row.

### `PATCH /api/reservations/:id` *(CASHIER+)*
Partial update. Any of: `customerName`, `customerPhone`, `partySize`,
`reservedAt` (ISO string), `durationMinutes`, `tableNumber` (string | null),
`notes` (string | null). 409 if reservation is `COMPLETED` or `CANCELLED`.

### `POST /api/reservations/:id/seat` *(CASHIER+)*
Mark the guest as seated. Body: `{ tableNumber?, orderId? }`.
- `orderId` is the optional `Order.id` to attach (must be `OPEN`).
- Status transitions to `SEATED`. 409 if the reservation is not `BOOKED`.

### `POST /api/reservations/:id/cancel` *(CASHIER+)*
Cancel a reservation. Body: `{ reason: "..." }`. The reason is appended
to the `notes` field with a `[CANCELLED]` prefix. 409 if the reservation
is already `COMPLETED` / `CANCELLED` / `NO_SHOW`.

### `POST /api/reservations/:id/no-show` *(CASHIER+)*
Mark the guest as no-show. 409 if not in `BOOKED` / `SEATED` state.

### `OrderType` enum
Sprint 9.1 adds the new value `KIOSK`:
```
DINE_IN | TAKEAWAY | DELIVERY | KIOSK
```
Used as `Order.type` for orders created via the kiosk checkout.

---

## Tables (`/api/tables`) — Sprint 9.3

Waiter handheld — table-first floor management. All routes require auth.
Create / update require `MANAGER`+; open / close / transfer require `CASHIER`+;
list / detail are read-only.

### `GET /api/tables?branchId=X&status=OCCUPIED&includeInactive=false`
List tables. `branchId` defaults to the user's effective branch. `status`
optional filter (`AVAILABLE` | `OCCUPIED` | `RESERVED` | `CLEANING`).
`includeInactive=true` includes soft-deleted tables. Each row includes
`currentSession` (the active `TableSession`, if any) and `currentOrder`
(the attached Order, if any) so the floor view can be rendered in one fetch.

### `GET /api/tables/:id`
Table detail with the 25 most recent sessions and the current OPEN session's
order (if any).

### `POST /api/tables` *(MANAGER+)*
Create a table.
```json
{
  "branchId": "...",
  "number": "5",
  "capacity": 4,
  "area": "Outdoor",
  "positionX": 30,
  "positionY": 60
}
```
`number` is unique per branch. `positionX` / `positionY` are normalized
0..100 for floor-map rendering. 409 on duplicate `(branchId, number)`.

### `PATCH /api/tables/:id` *(MANAGER+)*
Partial update. Any of `number`, `capacity`, `area` (string | null),
`positionX` / `positionY` (number 0..100 | null), `status`
(`AVAILABLE` | `OCCUPIED` | `RESERVED` | `CLEANING`), `isActive`.
Use this to mark a table as `CLEANING → AVAILABLE` after the floor is reset,
or `AVAILABLE → RESERVED` for an upcoming booking.

### `POST /api/tables/:id/open` *(CASHIER+)*
Open a table session. Body:
```json
{
  "partySize": 4,
  "serverUserId": "...",
  "customerName": "Budi",
  "notes": "alergi seafood",
  "items": [
    { "menuItemId": "...", "quantity": 2, "notes": "less spicy" }
  ]
}
```
`serverUserId` defaults to the current user. `items` is optional; if omitted,
the OPEN order is created empty and items can be added via the regular
order detail page. On success:
- creates an `OPEN` Order (type=`DINE_IN`) with `tableNumber` set
- creates a `TableSession` linked to that order
- flips the table to `OCCUPIED`

409 if the table already has an open session. Returns 201 with
`{ table, session, order }`.

### `POST /api/tables/:id/close` *(CASHIER+)*
Close the active session. The order is NOT auto-paid — it can still be paid
via the regular order flow. The table is moved to `CLEANING` (manager
later PATCHes it back to `AVAILABLE`). 404 if no active session.

### `POST /api/tables/:id/transfer` *(CASHIER+)*
Move the active session to a different table in the same branch. Body:
```json
{ "toTableId": "..." }
```
The order's `tableNumber` is updated to the destination's number. Source
table is moved to `CLEANING`; destination is moved to `OCCUPIED`. 409 if
the destination is already occupied.

### WebSocket events (Sprint 9.3)
New event types on the existing `/ws` channel: `table.opened`,
`table.closed`, `table.transferred`. Each carries `branchId`,
`tableId` / `tableNumber`, and `sessionId` so the waiter floor view can
auto-update across devices.

### Table error codes
- `TableInactive` (409) — table is `isActive = false`
- `TableAlreadyOpen` (409) — table already has an OPEN session
- `NoActiveSession` (404) — close/transfer called with no open session
- `DestinationOccupied` (409) — transfer target is occupied
- `DuplicateTable` (409) — `(branchId, number)` collision

---

## Menu Engineering (`/api/menu-engineering`) — Sprint 9.4

BCG (Boston Consulting Group) matrix analysis over paid order items.
Quadrants: `STAR` (Bintang), `PLOWHORSE` (Kuda), `PUZZLE` (Teka-teki),
`DOG` (Anjing). All routes require auth. Snapshot generation requires
`OWNER` or `MANAGER`; list / detail are read-only.

### `POST /api/menu-engineering/snapshot` *(OWNER, MANAGER)*
Generate and persist a snapshot. Body:
```json
{
  "branchId": "...",
  "periodStart": "2026-06-01T00:00:00+07:00",
  "periodEnd":   "2026-06-20T23:59:59+07:00"
}
```
Aggregates every `PAID` order in the period (filtered on `closedAt`),
groups OrderItems by `menuItemId`, computes per-item:
- `totalQty`, `totalRevenueCents`, `totalCostCents`, `marginCents`
- `popularityPct` = `totalQty / sum(totalQty) * 100`
- `marginPct`     = `marginCents / sum(marginCents) * 100`
- `quadrant`      = median split: high pop ≥ median, high margin ≥ median

Returns 201 with the full snapshot including `items` and `totals`.

### `GET /api/menu-engineering/snapshots?branchId=X&limit=12`
List recent snapshots, newest first. `limit` clamped to 1..100 (default 12).

### `GET /api/menu-engineering/snapshots/:id`
Fetch one snapshot. Returns the same shape as the create response.

---

## Suppliers (`/api/suppliers`) — Sprint 9.5

Branch-scoped supplier directory. Soft-delete via `isActive=false`.

### `GET /api/suppliers?branchId=X&includeInactive=true&search=…`
List suppliers for the branch.

### `POST /api/suppliers` *(OWNER, MANAGER)*
Create. Body: `{ branchId, name, contactName?, phone?, email?, address?, notes?, isActive? }`.

### `PATCH /api/suppliers/:id` *(OWNER, MANAGER)*
Partial update of any supplier field.

---

## Purchase Orders (`/api/purchase-orders`) — Sprint 9.5

Status flow: `DRAFT → SENT → PARTIAL → RECEIVED`, with `CANCELLED`
allowed from `DRAFT` or `SENT` (OWNER only). PO numbers are auto-generated
as `PO-YYYYMMDD-NNNN` per (branch, day) with collision retry on
concurrent creation.

### `GET /api/purchase-orders?branchId=X&status=DRAFT&supplierId=…`
List POs for a branch (optional status / supplier filter).

### `GET /api/purchase-orders/:id`
Get PO detail with items + enriched inventory item summaries.
`subtotalCents` and `totalCents` are returned as strings (BigInt).

### `POST /api/purchase-orders` *(OWNER, MANAGER)*
Create DRAFT PO. Body:
```json
{
  "branchId": "...",
  "supplierId": "...",
  "notes": "Restock mingguan",
  "expectedAt": "2026-06-25T00:00:00Z",
  "items": [
    { "inventoryItemId": "...", "qtyOrdered": 50, "unitCostCents": 15000 }
  ]
}
```
Validates supplier is in branch and active, items exist in branch,
computes subtotal/total in cents. `qtyOrdered` accepts decimals
(stored as String for forward compat).

### `PATCH /api/purchase-orders/:id` *(OWNER, MANAGER)*
DRAFT only. Update notes/expectedAt and/or replace items (delete+create).

### `POST /api/purchase-orders/:id/send` *(OWNER, MANAGER)*
Transition `DRAFT → SENT`.

### `POST /api/purchase-orders/:id/receive` *(OWNER, MANAGER)*
Body:
```json
{ "items": [{ "poItemId": "...", "qtyReceived": 50 }] }
```
For each line, increments inventory quantity and writes a `PURCHASE`
`InventoryLog` entry with `reference = po.id`. The PO status auto-
transitions to `PARTIAL` (some received) or `RECEIVED` (all complete).
Each line's `qtyReceived` must be `> previous qtyReceived` and `≤ qtyOrdered`.

### `POST /api/purchase-orders/:id/cancel` *(OWNER)*
Transition `DRAFT` or `SENT` to `CANCELLED` (sets `cancelledAt`).

---

## Prep Sheets (`/api/prep-sheets`) — Sprint 9.6

Kitchen prep guidance based on past N days of paid order items.
Per-menu-item recommendation with day-of-week adjustment.

### `POST /api/prep-sheets/generate` *(OWNER, MANAGER)*
Body: `{ branchId, date: "YYYY-MM-DD", lookbackDays?: number, notes? }`.
`lookbackDays` defaults to 14, range 3..60. Persists a `PrepSheet` row
with `itemsJson` containing the per-item recommendation.

Algorithm:
1. Aggregate paid OrderItems in `[date - lookbackDays, date)`.
2. Per menu item: `avgQtyPerDay = total / lookbackDays`.
3. DOW adjustment: ratio of same-day-of-week avg vs overall avg,
   clamped 0.5..1.5.
4. `recommendedQty = round(avgQtyPerDay * dayOfWeekFactor)`.

Returns the created sheet with `items` array:
```json
{
  "id": "...",
  "branchId": "...",
  "date": "2026-06-20",
  "lookbackDays": 14,
  "items": [
    {
      "menuItemId": "...",
      "name": "Nasi Goreng",
      "categoryId": "...",
      "categoryName": "Main Course",
      "avgQtyPerDay": 24.5,
      "dayOfWeekFactor": 1.18,
      "recommendedQty": 29,
      "last7DayQty": 180
    }
  ]
}
```

### `GET /api/prep-sheets?branchId=X&date=YYYY-MM-DD`
List prep sheets (newest first, optional date filter).

### `GET /api/prep-sheets/:id`
Get a single prep sheet (raw `itemsJson`).

---

## Accounting Export (`/api/accounting-export`) — Sprint 9.7

Download sales & purchase journals in CSV form, formatted for direct
import into Indonesian accounting SaaS (Jurnal by Mekari, Accurate
Online, the legacy Mekari Accounting product, or a generic canonical
export for ad-hoc uploads).

**All endpoints require `OWNER` or `MANAGER`.**

Supported `format` values: `JURNAL`, `ACCURATE`, `MEKARI`, `GENERIC`.
Default: `JURNAL`.

The response is `text/csv; charset=utf-8` with a UTF-8 BOM (so Excel
reads accented characters correctly), CRLF line endings, and a
`Content-Disposition: attachment; filename="..."` header.

**Suggested Indonesian chart-of-accounts** (the import can remap these
on the SaaS side):

| CoA    | Account name                |
|--------|-----------------------------|
| `1100` | Kas                         |
| `1200` | Bank                        |
| `1300` | Persediaan Bahan Baku       |
| `2000` | Hutang Usaha                |
| `2100` | PPN Keluaran                |
| `2200` | PPN Masukan                 |
| `4000` | Penjualan                   |
| `4100` | Diskon Penjualan            |
| `5000` | Beban Bahan Baku (consumed) |

### `GET /api/accounting-export/sales-journal.csv`

Query params: `branchId`, `from` (`YYYY-MM-DD`), `to` (`YYYY-MM-DD`),
`format`.

Returns one sales journal CSV. Each `PAID` order in the period produces
1..4 lines depending on whether discount / PPN was applied:

- **JURNAL** (header in Indonesian): `Tanggal | Nomor Bukti | Deskripsi | Akun | Debit | Kredit | Catatan`
- **ACCURATE**: `Tanggal | No. Bukti | Keterangan | Debit | Kredit | Akun`
- **MEKARI**: `Date | Ref No | Description | Account | Debit | Credit | Project`
- **GENERIC**: `date | branch_code | order_number | payment_method | subtotal_cents | discount_cents | tax_cents | total_cents`

Example (JURNAL):
```
Tanggal,Nomor Bukti,Deskripsi,Akun,Debit,Kredit,Catatan
2026-06-20,ORD-20260620-0001,Penjualan BKJ-01 #ORD-20260620-0001,1100,33500,0,Metode: QRIS
2026-06-20,ORD-20260620-0001,Penjualan BKJ-01 #ORD-20260620-0001,4000,0,30000,
2026-06-20,ORD-20260620-0001,Penjualan BKJ-01 #ORD-20260620-0001 (PPN),2100,0,3500,
```

### `GET /api/accounting-export/purchase-journal.csv`

Same query params. Returns one row per PO line on `PARTIAL` or
`RECEIVED` POs whose `receivedAt` falls in the period. The default
journal entry is `Debit 1300 (Inventory) → Kredit 2000 (Hutang Usaha)`.

**Important**: the amounts in this export are integer IDR (no sub-unit
division). When importing into a system that expects cents, divide
each cell by 100 in the SaaS's import template.

---

## Waste Tracking (`/api/waste`) — Sprint 9.9

Track food waste, ingredient waste, and packaging waste. Soft-delete
via `status` (set to `DELETED` on `DELETE`); `GET` excludes
`DELETED` rows unless `?includeDeleted=true`.

### `GET /api/waste?branchId=X&from=YYYY-MM-DD&to=YYYY-MM-DD&type=FOOD`
List waste entries. Query params:
- `branchId` — defaults to current user's branch
- `from` / `to` — `YYYY-MM-DD`; inclusive bounds on `recordedAt`
- `type` — `FOOD` | `INGREDIENT` | `PACKAGING` (optional)
- `includeDeleted` — `true` to also return `DELETED` rows
- `limit` — max 500, default 100

Returns `{ entries: WasteEntry[], count: number }`. Each entry is
enriched with `menuItem` / `inventoryItem` (name + sku) and
`recordedBy` (name + role).

### `POST /api/waste` *(CASHIER, MANAGER, OWNER)*

Body:
```json
{
  "branchId": "...",
  "type": "FOOD",
  "menuItemId": "...",
  "quantity": 2,
  "reason": "kitchen mistake",
  "notes": "fallback: optional",
  "recordedAt": "2026-06-20T08:00:00Z"
}
```

Either `menuItemId` (for `FOOD`) or `inventoryItemId` (for
`INGREDIENT` / `PACKAGING`) is required.

**Auto cost lookup**:
- If `menuItemId` is set and `totalCostCents` is omitted, server uses
  `MenuItem.costCents × quantity` and stores both `unitCostCents` and
  `totalCostCents`.
- If `inventoryItemId` is set and `totalCostCents` is omitted, server
  uses `InventoryItem.costPerUnit × quantity` (Decimal IDR/unit) →
  cents and stores both fields.

If you pass `unitCostCents` and `totalCostCents` explicitly, those win
(useful when the cost differs from the master data, e.g. supplier
already-invoiced a different price).

### `PATCH /api/waste/:id` *(OWNER, MANAGER)*

Partial update. Send any of the writable fields. If `quantity` /
`unitCostCents` / `totalCostCents` is changed, server recomputes the
others (using the cost-lookup rules above). Cannot patch a `DELETED`
entry.

### `DELETE /api/waste/:id` *(OWNER)*

Soft delete: sets `status = 'DELETED'`. The row is preserved for audit
and excluded from default list + summary queries.

### `GET /api/waste/summary?branchId=X&days=30` *(OWNER, MANAGER)*

Aggregated waste for the last `days` days (default 30, max 365).
Returns:

```json
{
  "periodDays": 30,
  "from": "2026-05-21T00:00:00Z",
  "to": "2026-06-20T23:59:59Z",
  "branchId": "...",
  "totalCount": 47,
  "totalCostCents": 245000,
  "byType": {
    "FOOD":        { "count": 23, "costCents": 130000 },
    "INGREDIENT":  { "count": 18, "costCents": 95000 },
    "PACKAGING":   { "count": 6,  "costCents": 20000 }
  },
  "topItems": [
    { "key": "FOOD:clxyz...", "name": "Nasi Goreng", "type": "FOOD", "count": 12, "costCents": 72000 }
  ],
  "byReason": [
    { "reason": "kitchen mistake", "count": 15, "costCents": 80000 }
  ]
}
```

---

## i18n / Multi-language — Sprint 9.8

The web app supports two UI languages: Indonesian (default, `id`) and
English (`en`). The choice is stored in a `pos_locale` cookie
(persistent, 1-year max-age) and mirrored in `localStorage`. Locale
resolution order at boot:
1. `pos_locale` cookie
2. `localStorage.getItem('pos_locale')`
3. `navigator.language` (English if it starts with `en`, else default
   to `id`)
4. Fallback: `id`

To override per-request from a script, set the cookie before the page
loads: `document.cookie = "pos_locale=en; path=/"`.

The user-facing switcher is a dropdown in the top-right of the
`/pos` header.

Programmatic API (client-only, see `apps/web/src/lib/i18n.ts`):
- `useT()` — returns a `t(key, params?)` function. Keys are dot-paths
  into `apps/web/src/messages/{id,en}.json` (e.g. `t('waste.title')`).
  Missing keys fall back to the default locale, then to the raw key
  (visible in dev).
- `useLocale()` — returns the current `Locale` reactively.
- `useSetLocale()` — returns a setter that updates cookie + storage +
  broadcasts a `pos_locale_changed` window event.

The API is JSON-only and not localized; only the web UI strings are
translated.

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
| `SessionExpired` | 410 | Kiosk session expired/abandoned |
| `SessionClosed` | 409 | Kiosk session already checked-out / abandoned |
| `EmptyCart` | 400 | Kiosk checkout attempted with empty cart |
| `MenuItemUnavailable` | 409 | Cart contains an item no longer available |
| `ReservationClosed` | 409 | Reservation already COMPLETED / CANCELLED |
| `InvalidStatus` | 409 | Reservation in wrong status for the requested action |
| `ConfigError` | 500 | Branch has no OWNER/MANAGER user (kiosk checkout) |
| `TableInactive` | 409 | Table is `isActive = false` |
| `TableAlreadyOpen` | 409 | Table already has an OPEN session |
| `NoActiveSession` | 404 | Close/transfer called with no open session |
| `DestinationOccupied` | 409 | Transfer target is occupied |
| `DuplicateTable` | 409 | `(branchId, number)` collision on Table create/update |
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
