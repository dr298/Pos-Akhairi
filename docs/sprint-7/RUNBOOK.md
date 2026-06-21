# RUNBOOK — pos.akhairi.com (Staff)

**Audience:** Cashier, Manager, Owner
**Version:** 2026-06-20 (post-Sprint 9+ wrap)
**Login:** https://pos.akhairi.com/login

---

## Quick reference (print this)

| Need | Where |
|------|-------|
| Take order | `/pos` |
| View past orders | `/pos/history` |
| Shift open/close | `/pos/shift` |
| Customer display (2nd screen) | `/display` (different device) |
| Delivery orders (GoFood/GrabFood/ShopeeFood) | `/pos/delivery` |
| Add/edit menu | `/pos/menu` |
| End-of-day report | `/pos/shift` → "Tutup Shift" |

Test logins:
- `owner@bkj.id` / `password123` — all features
- `manager@bkj.id` / `password123` — operational
- `cashier@bkj.id` / `password123` — cashier

---

## Daily opening (Manager, 08:00)

1. Login → `/pos/shift`
2. Click **"Buka Shift"**, input opening cash (e.g. 300.000)
3. Shift starts. Cashiers can now take orders.
4. Optional: check `/api/ready` works (green status)

## Per-cashier setup

1. Login → `/pos/shift` (or first time will prompt)
2. Take orders via `/pos`

---

## Taking an order (Cashier, `/pos`)

1. Pick category (Bakmi, Minuman, etc)
2. Tap item → opens modifier dialog if any
3. Pick modifiers (e.g. "Topping: Bakso", "Pedas: Sedang")
4. **Tambah ke Keranjang**
5. Repeat for more items
6. **Bayar** → choose method:
   - **Tunai** → input cash received → auto-calc change → **Bayar Sekarang**
   - **QRIS** → shows QR code → wait for webhook to confirm → auto-print receipt
   - **Split bill** (Manager+) → split across methods
7. Receipt prints automatically (or shows in `/pos/orders/[id]/receipt` for digital)

**Pro tip:** the cart updates in real-time via WebSocket. If you see "—" in customer display, refresh.

---

## Combo / Set meal (Cashier)

Combos are pre-set groups of items at a fixed price. They appear in `/pos` under a **"Paket"** category.

- Tap combo → automatically adds all items to cart
- Cannot be modified (use individual items if customer wants custom)

To add a combo: Manager → `/pos/menu/combos`

---

## Promo / Diskon (Cashier)

Promos are auto-applied if conditions match (e.g. min purchase, day-of-week, specific items). If a customer asks "ada promo?", check:

- `/pos/promos` (Manager) — list of active promos
- If you add an item, the cart shows the **discount badge** if promo applies

To manually apply a non-auto promo: add a discount line in cart (Manager+ only).

---

## Member / Loyalty (Cashier)

1. At checkout, click **"Pilih Member"**
2. Search by phone (last 4 digits) or name
3. Pick customer → points earned this transaction auto-calculated (e.g. 1% of total)
4. To **redeem points**: click "Tukar Poin" → choose reward → points deducted, discount applied

To register a new member: Manager → `/pos/customers` → "Tambah"

---

## Digital receipt (Cashier)

Auto-sent to customer's phone/email IF the order has customer + channel configured.

To **manually resend**: `/pos/orders/[id]/receipt` → "Kirim WhatsApp" / "Kirim Email"

(If buttons are disabled, customer didn't provide phone/email at order time.)

---

## Barcode scanner (Cashier, `/pos`)

1. Plug in USB scanner OR pair Bluetooth scanner (Settings → Hardware)
2. Scan item → auto-adds to cart
3. Failed scan → "Barcode X tidak ditemukan" toast → check `/pos/menu` for barcode registration

To set a barcode on an item: Manager → `/pos/menu` → edit item → "Barcode" field.

---

## Cash drawer (Cashier, paid in cash)

- Drawer opens **automatically** on successful cash payment
- To test: `/pos/settings/hardware` → "Buka Drawer (Test)"
- Drawer doesn't open? Check USB/Bluetooth connection to printer

---

## Delivery orders (Cashier, `/pos/delivery`)

Auto-polled every 5s. New order = "🔔" notification + sound.

- **Accept** → creates local order (auto-routes to KDS)
- **Reject** → sends reason to aggregator (e.g. "Out of stock")
- **Mark PREPARING/READY** → status syncs to GoFood/GrabFood/ShopeeFood
- **Mark PICKED_UP/DELIVERED** → closes the order

If a channel is misbehaving: `/pos/channels` → "Test" or "Poll Now"

---

## Table / Waiter (Waiter, `/pos/waiter`)

- Mobile-first. Optimized for tablet/phone.
- Color-coded by status (green=free, blue=seated, yellow=ordered, orange=billed, red=cleaning)
- Tap table → "Buka Sesi" → take order via existing order UI
- "Transfer" moves session to another table

## Reservation (Manager, `/pos/reservations`)

- 30-min slot resolution, 90-min default duration
- View 7-day calendar + list of bookings
- "Hadir" when customer arrives → opens table session
- "Tidak Hadir" if 15min past slot + no-show

---

## Self-order kiosk (Owner, `/kiosk`)

- Set up a tablet at the entrance
- URL: `https://pos.akhairi.com/kiosk`
- No login required. Customer picks items → "Lanjut" → order created (K-#####)
- Status page: `https://pos.akhairi.com/kiosk/[orderId]`
- Cart auto-expires after 30min idle

---

## End of day (Manager, `/pos/shift`)

1. Verify all cashiers have closed their shifts
2. Click **"Tutup Shift"** on master shift
3. Z-report prints: total sales, by payment method, by category, voids, refunds
4. Export CSV if needed (Manager → `/pos` → Reports)
5. **Settlement**: count cash drawer, compare to report's cash total, click "Setujui"

---

## Weekly (Manager)

- **Menu engineering review**: `/pos/menu/engineering` → generate snapshot → identify Bintang (Star) to promote, Anjing (Dog) to retire
- **Waste tracking**: `/pos/waste` → review top 5 waste items, adjust prep quantities
- **Prep sheet**: `/pos/prep-sheets` → generate tomorrow's prep based on DOW

---

## Monthly (Owner)

- **Accounting export**: `/pos/accounting-export` → JURNAL/ACCURATE/MEKARI format → upload to accounting software
- **Backup verify**: `ls -lt /root/archives/pos-akhairi-backups/ | head -5` → at least 30 days
- **User audit**: `/pos/settings/users` (if exists) → review who's active, remove ex-employees
- **DR drill**: follow `docs/sprint-7/DR-RUNBOOK.md` to test restore

---

## When something breaks

| Symptom | First check |
|---------|-------------|
| Site 404 / 502 | `docker ps` — all containers running? |
| Login fails | `/api/ready` — is API up? |
| Orders not appearing | WebSocket disconnected? Refresh page |
| QRIS not confirming | `/pos/delivery` — webhook status. Wait 30s, retry. |
| Receipt not printing | `/pos/settings/hardware` — test print |
| Drawer not opening | Same as printer — usually same USB port |
| Aggregator stuck | `/pos/channels` → "Test" connection |
| Member search slow | Postgres index — reindex if > 10K members |
| Backup missing | Check cron: `crontab -l \| grep pos-akhairi` |

**Escalation:** if no joy after 15min, capture `/api/ready` + `/api/metrics` output + last 200 lines of `docker logs pos-api` and send to Owner.

---

## Switching language

- ID/EN switcher in the top-right of POS layout (compact dropdown)
- Choice persists in cookie + localStorage
- Default: Indonesian (id)

---

## Need to add a new feature?

1. Owner creates an issue in `github.com/dr298/Pos-Akhairi/issues`
2. Label: `feature`, `priority-X`
3. AI agent (Friday) picks up via cron, proposes plan
4. Owner approves, sprint kicks off
