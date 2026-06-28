#!/bin/sh
# Sprint 12 E2E — runs entirely inside the pos-api container.
# - Reaches API at http://127.0.0.1:9797
# - Reaches DB via psql client to pos-postgres:5432

set -eu

API=http://127.0.0.1:9797
PSQL="psql -h pos-postgres -U pos -d pos_akhairi -At"

# Override the password env for psql
export PGPASSWORD=***

CK=/tmp/cookies-s12.txt
rm -f $CK

echo "== Login =="
wget --quiet --save-cookies $CK --keep-session-cookies -O- --post-data='{"email":"owner@bkj.id","password":"password123"}' --header='Content-Type: application/json' $API/api/auth/login > /dev/null
# Fix cookie secure flag (wget 1.21+ refuses to send secure cookies over HTTP)
sed -i 's/	TRUE	178[0-9]*	/	FALSE	178[0-9]*	/' $CK 2>/dev/null || true
echo "  ✓"

get() { wget --quiet --load-cookies $CK -O- "$API$1"; }
post() { wget --quiet --load-cookies $CK -O- --post-data="$2" --header='Content-Type: application/json' "$API$1"; }
put() { wget --quiet --load-cookies $CK -O- --method=PUT --body-data="$2" --header='Content-Type: application/json' "$API$1"; }
n_jq() { node -e "let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s); $1})"; }

db() { $PSQL -c "$1"; }

echo ""
echo "== T0: Seed suppliers =="
supplier_count=$(db "SELECT COUNT(*) FROM suppliers;")
if [ "$supplier_count" = "0" ]; then
  echo "  no suppliers — seeding"
  $PSQL -c "INSERT INTO suppliers (id, name, contact_name, phone, is_active, created_at, updated_at) VALUES ('sup_a', 'Supplier A (Test)', 'Bpk A', '0812-0000-0001', true, NOW(), NOW()), ('sup_b', 'Supplier B (Test)', 'Bpk B', '0812-0000-0002', true, NOW(), NOW());" >/dev/null
  echo "  ✓ seeded 2"
else
  echo "  ✓ $supplier_count exist"
fi

echo ""
echo "== T1: PO receive creates InventoryBatch =="
supplier_id=$(get /api/suppliers | n_jq "console.log(j.data.suppliers[0].id)")
inv_id=$(get /api/inventory | n_jq "console.log(j.data.items[0].id)")
echo "  supplier=$supplier_id inv=$inv_id"

before=$(db "SELECT COUNT(*) FROM inventory_batches;")
echo "  batches before: $before"

qty=50; cost=27000
po_body="{\"supplierId\":\"$supplier_id\",\"items\":[{\"inventoryItemId\":\"$inv_id\",\"qtyOrdered\":$qty,\"unitCostCents\":$cost}]}"
po=$(post /api/purchase-orders "$po_body")
po_id=$(echo "$po" | n_jq "console.log(j.data.purchaseOrder.id)")
po_item_id=$(echo "$po" | n_jq "console.log(j.data.purchaseOrder.items[0].id)")
echo "  PO: $po_id"

wget --quiet --load-cookies $CK -O- --post-data="" --header='Content-Type: application/json' $API/api/purchase-orders/$po_id/send > /dev/null
recv_body="{\"items\":[{\"poItemId\":\"$po_item_id\",\"qtyReceived\":$qty}]}"
post /api/purchase-orders/$po_id/receive "$recv_body" > /dev/null

after=$(db "SELECT COUNT(*) FROM inventory_batches;")
echo "  batches after: $after"
[ $after -gt $before ] && echo "  ✓ new batch created" || { echo "  ✗ no batch"; exit 1; }

batch_qty=$(db "SELECT qty_remaining FROM inventory_batches WHERE purchase_order_id='$po_id';")
echo "  new batch qty: $batch_qty"
[ "$batch_qty" = "$qty.0000" ] && echo "  ✓ qty matches" || { echo "  ✗ qty=$batch_qty"; exit 1; }

po_status=$(db "SELECT status FROM purchase_orders WHERE id='$po_id';")
[ "$po_status" = "RECEIVED" ] && echo "  ✓ PO RECEIVED" || { echo "  ✗ $po_status"; exit 1; }

echo ""
echo "== T2: Recipe + computedHppCents =="
menu_id=$(get /api/menu/items | n_jq "console.log(j.data[0].id)")
echo "  menu: $menu_id"
inv2_id=$(get /api/inventory | n_jq "console.log(j.data.items[1].id)")
inv_unit=$(get /api/inventory | n_jq "console.log(j.data.items[0].unit)")
inv2_unit=$(get /api/inventory | n_jq "console.log(j.data.items[1].unit)")

recipe_body="{\"recipes\":[{\"inventoryItemId\":\"$inv_id\",\"quantity\":0.2,\"unit\":\"$inv_unit\"},{\"inventoryItemId\":\"$inv2_id\",\"quantity\":0.1,\"unit\":\"$inv2_unit\"}]}"
put /api/menu/items/$menu_id/recipes "$recipe_body" > /dev/null
echo "  recipe PUT"

sleep 2

menu=$(get /api/menu/items/$menu_id)
hpp_src=$(echo "$menu" | n_jq "console.log(j.data.hppSource)")
hpp_cents=$(echo "$menu" | n_jq "console.log(j.data.computedHppCents)")
breakdown_n=$(echo "$menu" | n_jq "console.log((j.data.hppBreakdown||[]).length)")
echo "  hppSource=$hpp_src hpp=$hpp_cents breakdown=$breakdown_n"

[ "$hpp_src" = "RECIPE" ] && echo "  ✓ hppSource=RECIPE" || { echo "  ✗ hppSource=$hpp_src"; exit 1; }
[ "$hpp_cents" -gt 0 ] && echo "  ✓ hppCents > 0" || { echo "  ✗ hpp=$hpp_cents"; exit 1; }
[ "$breakdown_n" = "2" ] && echo "  ✓ breakdown 2 items" || { echo "  ✗ breakdown=$breakdown_n"; exit 1; }

db_cost=$(db "SELECT cost_cents FROM menu_items WHERE id='$menu_id';")
[ "$db_cost" = "$hpp_cents" ] && echo "  ✓ DB costCents=$hpp_cents" || { echo "  ✗ db=$db_cost"; exit 1; }

echo ""
echo "== T3: Order + hppCentsUsed + batch decrement =="
batch_before=$(db "SELECT qty_remaining FROM inventory_batches WHERE inventory_item_id='$inv_id' AND qty_remaining > 0 ORDER BY received_at ASC LIMIT 1;")
echo "  batch before: $batch_before"

order_id=$(post /api/orders '{"type":"DINE_IN"}' | n_jq "console.log(j.data.order.id)")
echo "  order: $order_id"
post /api/orders/$order_id/items "{\"menuItemId\":\"$menu_id\",\"quantity\":1}" > /dev/null
post /api/orders/$order_id/pay '{"provider":"CASH","method":"CASH","amountGiven":100000}' > /dev/null

oi=$(db "SELECT hpp_cents_used||'|'||COALESCE(batch_consumptions::text, '') FROM order_items WHERE order_id='$order_id';")
hpp_used=$(echo "$oi" | cut -d'|' -f1)
cons=$(echo "$oi" | cut -d'|' -f2)
echo "  hppCentsUsed=$hpp_used"
echo "  batchConsumptions=$cons"

[ "$hpp_used" != "" ] && [ "$hpp_used" != "0" ] && echo "  ✓ hppCentsUsed set" || { echo "  ✗ hpp=$hpp_used"; exit 1; }
echo "$cons" | grep -q "$inv_id" && echo "  ✓ batchConsumptions refs batch" || { echo "  ✗ missing ref"; exit 1; }

batch_after=$(db "SELECT qty_remaining FROM inventory_batches WHERE inventory_item_id='$inv_id' AND qty_remaining > 0 ORDER BY received_at ASC LIMIT 1;")
echo "  batch after: $batch_after"
node -e "if(!(parseFloat('$batch_after') < parseFloat('$batch_before'))) { process.exit(1) }" && echo "  ✓ batch decremented" || { echo "  ✗ batch not decremented"; exit 1; }

echo ""
echo "== Cleanup =="
put /api/menu/items/$menu_id/recipes '{"recipes":[]}' > /dev/null
echo "  ✓ recipe cleared"

echo ""
echo "ALL SPRINT 12 HPP TESTS PASSED ✓"
