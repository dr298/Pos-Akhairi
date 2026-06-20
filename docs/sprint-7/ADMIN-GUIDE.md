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

## Branch switcher

If you have access to multiple branches, the header shows a branch dropdown.
Click to switch. All subsequent menu/orders/reports data is scoped to that branch.

Manage access: `Settings → Branches → [branch] → Users` (UI pending — use `UserBranchAccess` table via psql for now).

---

## Branch settings (`/pos/branches`)

OWNER only.

For each branch you can edit:
- Name, address, city, phone
- **PPN (Indonesian VAT) config** (Sprint 5.6):
  - `Persentase PPN` (basis points, 1100 = 11%)
  - `Inklusif` checkbox: when checked, prices DISPLAY already include PPN (tax is back-calculated)
  - 0% PPN = tax-free branch (common for outlets with PKP exemption)

**How PPN is applied to orders:**
- Each menu item has a `taxRateBp` (default 1100 = 11%) and `useBranchPpn` flag.
- Order calculation:
  1. If item has explicit `taxRateBp > 0` → use it
  2. Else if `useBranchPpn=true` and branch has `ppnPercent > 0` → use branch PPN
  3. Else → no tax
- If `ppnInclusive=true` → tax = subtotal − floor(subtotal × 10000 / (10000 + rate))

---

## Menu management (`/pos/menu`)

Three tabs:

### 1. Items
- List all menu items for the active branch
- Filter by category, search by name
- Edit price inline (Patches `PATCH /api/menu/items/:id`)
- Create new item (name, price, category, tax rate, useBranchPpn, image)
- Toggle active/inactive

### 2. Categories
- CRUD for menu categories
- Drag-to-reorder (planned, not yet implemented)

### 3. Copy antar Cabang (Sprint 5.4)
Bulk-copy menu from one branch to another:
- Select source branch
- System fetches source menu, groups by category
- Map source categories to target categories (or auto-create)
- Per-item price override field (defaults to source price)
- Skip existing (don't overwrite items already at target)
- "Salin" button: POST /api/menu/clone

Result: target branch gets new items in one go. Use case: opening a new branch
or seasonal menu refresh.

---

## Stock transfer (`/pos/transfers`)

OWNER + MANAGER.

Workflow:
1. **Create** transfer: select destination branch, add items with qty + cost, notes
2. Status: `PENDING` (not yet sent)
3. **Send**: source branch stock decremented, status → `IN_TRANSIT`
4. **Receive** at destination: actual qty received (may differ from sent), status → `RECEIVED`. Adds stock to destination.
5. **Cancel** a PENDING transfer: no stock changes

Notes:
- Transfers are atomic per-item at receive time (qty received can vary)
- Cost is informational (for cost-of-goods analysis); doesn't affect book value

---

## Z-report (`/pos/z-report`)

End-of-day report. Per branch.

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

## Chain dashboard (`/pos/chain`)

Sprint 5.3. HQ view across all branches.

Shows:
- Total gross / order count / avg ticket
- Per-branch breakdown table (orders, paid, void, refund, gross, EOD cash)
- Top 5 branches by revenue
- Channel performance
- Low stock alerts across branches

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

Generates a daily close record. Locks the day for that branch.

---

## Error monitoring (`/api/errors`)

OWNER only. Self-hosted error tracker (Sprint 7.2).

View recent errors with filters (severity, route, since). Each error includes:
- Request ID (cross-reference with logs)
- User / branch context
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
INSERT INTO users (id, email, password_hash, name, role, branch_id, is_active, created_at, updated_at)
VALUES (
  'usr_' || substr(md5(random()::text), 1, 24),
  'newuser@bkj.id',
  '$2a$10$...', -- bcrypt hash from `bcrypt-cli` or generated
  'New User',
  'CASHIER',
  'cmqlvwrtb00008c1k6vif6268', -- BKJ-PASAR-LAMA
  true,
  now(),
  now()
);
```

### Grant a user access to multiple branches
```sql
INSERT INTO user_branch_access (id, user_id, branch_id, role, is_default)
VALUES
  ('uba1', 'usr_xxx', 'cmqlvwrtb00008c1k6vif6268', 'CASHIER', true),
  ('uba2', 'usr_xxx', 'cusks5ank6bkavx8mmacqg1er', 'CASHIER', false);
```

### Deactivate a user
```sql
UPDATE users SET is_active = false, updated_at = now() WHERE id = 'usr_xxx';
```
The user can't log in but historical orders/payments remain attributed.

### Reset a cashier's stuck shift
Only OWNER. Use `POST /api/shifts/:id/close` with `actualClosingCash` = expected.
Document the incident in the shift `notes` field.
