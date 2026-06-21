# Admin Guide — pos.akhairi.com

**Role: OWNER** (full access) or **MANAGER** (operational, no destructive admin).

Live at: `https://pos.akhairi.com` (Cloudflare → Docker stack in Hono + Next.js 16 + Postgres).

---

## Login

URL: `/login`
Default seeded credentials (dev/staging only — change in production):
- Owner: `owner@bkj.id` / `password123`
- Manager: `manager@bkj.id` / `password123`
- Cashier: `cashier@bkj.id` / `password123`

Production: generate strong passwords via `secrets-vault` skill, set via OWNER.

---

## Menu management (`/pos/menu`)

Three tabs:

### 1. Items
- List all menu items
- Filter by category, search by name
- Edit price inline (Patches `PATCH /api/menu/items/:id`)
- Create new item (name, price, category, tax rate, image)
- Toggle active/inactive

### 2. Categories
- CRUD for menu categories
- Drag-to-reorder (planned, not yet implemented)

---

## Z-report (`/pos/z-report`)

End-of-day report.

Pick a date (default today) and see:
- Summary cards: Gross, Net, Tax, Discount, Void, Refund, Order count
- By payment method
- By order type (DINE_IN / TAKEAWAY / DELIVERY)
- By channel (POS / GoFood / GrabFood / ShopeeFood)
- By category
- By hour (chart of order volume throughout the day)
- Top 20 items
- Shift reconciliation (opening, expected, actual, variance)
- Void log (who voided what, why)
- Refund log

Export CSV button: full Z-report as CSV for accountant.

---

## Channels (`/pos/channels`)

Delivery aggregator config. GoFood, GrabFood, ShopeeFood.

For each channel:
- **Enable toggle**
- **API credentials**: store_id, client_id/secret, API key (encrypted at rest with AES-256-GCM)
- **Webhook secret** (HMAC verification)
- **Test connection** button
- **Manual poll** (force fetch orders now)
- **Menu sync** (push current menu to aggregator)
- **Analytics card** (7d/14d/30d toggle): orders, revenue, commission, on-time rate

Webhooks:
- `POST /api/webhooks/gofood` — public, HMAC verified
- `POST /api/webhooks/grabfood`
- `POST /api/webhooks/shopeefood`

---

## Daily close (`/pos/close`)

End-of-day task. Compares:
- Expected closing cash (opening + cash sales − cash refunds)
- Actual closing cash (cashier-entered)
- Variance (over/short)

Generates a daily close record. Locks the day.

---

## Error monitoring (`/api/errors`)

OWNER only. Self-hosted error tracker (Sprint 7.2).

View recent errors with filters (severity, route, since). Each error includes:
- Request ID (cross-reference with logs)
- User context
- Stack trace (truncated to 4KB)
- Sanitized context (secrets redacted)

---

## Backups

Automated daily at 03:00 (cron). Backups in `/root/archives/pos-akhairi-backups/`.
30-day retention. Format: `pos-akhairi-YYYYMMDD-HHMMSS.sql.gz` (custom pg_dump).

To restore: see `DR-RUNBOOK.md`.

---

## Disaster recovery

See `DR-RUNBOOK.md` for the full procedure. Summary:
- Daily automated backup, 30-day retention
- Restore takes < 5 minutes (downtime = restore time)
- Tested 2026-06-20 (RTO < 1 hour target met)

---

## Common admin tasks

### Add a new user
```sql
INSERT INTO users (id, email, password_hash, name, role, is_active, created_at, updated_at)
VALUES (
  'usr_' || substr(md5(random()::text), 1, 24),
  'newuser@bkj.id',
  '$2a$10$...', -- bcrypt hash from `bcrypt-cli` or generated
  'New User',
  'CASHIER',
  true,
  now(),
  now()
);
```

### Deactivate a user
```sql
UPDATE users SET is_active = false, updated_at = now() WHERE id = 'usr_xxx';
```
The user can't log in but historical orders/payments remain attributed.

### Reset a cashier's stuck shift
Only OWNER. Use `POST /api/shifts/:id/close` with `actualClosingCash` = expected.
Document the incident in the shift `notes` field.
