# Cashier Guide — pos.akhairi.com

**Role: CASHIER** (operational, scoped to your assigned branch).

---

## Login

1. Open `https://pos.akhairi.com/login`
2. Enter email + password (given by manager)
3. You'll land on `/pos` — the order entry screen

---

## Open shift (start of day)

1. From `/pos`, click **"Buka Shift"** button
2. Enter opening cash in drawer (e.g. `100000` for Rp 100.000)
3. Click **Submit** — you're now "on shift"

You cannot take payments without an open shift.

---

## Take an order

### Dine-in
1. Click **"Dine In"** tab (default)
2. Optional: enter table number
3. Browse menu by category, click items to add
4. Adjust quantity with +/- buttons
5. Add notes per item (e.g. "no chili", "extra egg")
6. Order is **OPEN** status — items show in cart on right
7. To send to kitchen without paying: click **"Kirim ke Dapur"** (status → PREPARING)

### Takeaway
1. Click **"Takeaway"** tab
2. Optional: customer name
3. Add items as above

### Delivery (manual, not from aggregator)
1. Click **"Delivery"** tab
2. Enter customer name + address + phone
3. Add items

### Aggregator order (GoFood/GrabFood/ShopeeFood)
Auto-imports. Appears in `/pos/orders` with channel badge.
Accept → creates local order, status PREPARING.
On customer pickup: status → PICKED_UP via aggregator app.

---

## Apply discount

1. Open order, in cart area click **"Tambah Diskon"**
2. Enter code (e.g. `PROMO10`) or select from active list
3. Discount applied to subtotal, recalculated PPN

---

## Payment

### Cash
1. Click **"Bayar"** button
2. Select **"Tunai"**
3. Enter amount given by customer
4. System calculates change automatically
5. Click **"Selesai"** → order → PAID, receipt prints

### QRIS (Midtrans)
1. Click **"Bayar"** → **"QRIS"**
2. Snap popup opens with QR code
3. Customer scans with their e-wallet
4. Webhook confirms payment → order auto → PAID

### Card / E-wallet (Xendit)
1. Click **"Bayar"** → **"Kartu"** (or DANA/OVO/GoPay)
2. Xendit invoice created
3. Customer completes on their app
4. Webhook confirms payment

### Split payment (partial)
Not yet supported (planned Sprint 8).

---

## Void an order

1. Open order from `/pos/orders`
2. Click **"Void"** button (only visible on OPEN orders)
3. Enter reason (e.g. "customer cancelled", "wrong items")
4. Order → VOIDED. Inventory restored.

**You cannot void a PAID order** — only MANAGER+ can REFUND.

---

## Close shift (end of day)

1. From `/pos`, click **"Tutup Shift"**
2. Count actual cash in drawer
3. Enter actual closing cash
4. System shows expected vs actual (variance)
5. Add notes if there's any variance
6. Click **Submit** — shift closed, locked for the day

If you forgot to close at end of day: manager/owner can force-close with reconciliation.

---

## Common issues

| Problem | Solution |
|---------|----------|
| "No open shift" | Click "Buka Shift", enter opening cash |
| Menu items empty | Wrong branch selected — check header dropdown |
| Order won't pay | Check order is OPEN, not already PAID/VOIDED |
| "Order closed" error | Already paid — refresh page |
| Payment stuck on QRIS | Wait 30s for webhook, or check network — ask manager |
| Forgot password | Ask manager/owner to reset (no self-serve yet) |

---

## Order status reference

| Status | Meaning | Who can change |
|--------|---------|----------------|
| `OPEN` | Created, not yet sent to kitchen | CASHIER, MANAGER, OWNER |
| `PREPARING` | Sent to kitchen, being cooked | KITCHEN, MANAGER, OWNER |
| `READY` | Ready for pickup/serve | KITCHEN, MANAGER, OWNER |
| `PAID` | Payment complete, done | (terminal) |
| `VOIDED` | Cancelled before payment | MANAGER, OWNER (void action) |
| `REFUNDED` | Paid, then money returned | OWNER (refund action) |

---

## Receipts

Every PAID order prints a receipt (system printer or PDF if no printer).
Receipt shows:
- Address
- Order number, date/time
- Cashier name
- Line items with qty + price
- Subtotal, PPN, discount, total
- Payment method + reference
- "Terima kasih"

---

## Hygiene / etiquette

- Always count opening cash carefully (that's your responsibility)
- Never share your login
- Log out when leaving the terminal (`/pos` header → "Logout")
- Report discrepancies immediately to manager
- Print duplicate receipts are not for customers — those are audit copies
