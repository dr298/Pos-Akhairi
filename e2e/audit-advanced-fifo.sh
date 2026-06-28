
#!/bin/sh
set -eu

# E2E: FIFO Batch Consumption

OUT_FILE="/root/audit-api-advanced-results.txt"
echo "====== audit-advanced-fifo.sh ======" >> $OUT_FILE

API_URL="https://pos-uat.akhairi.com"
CK="/tmp/cookies-audit-fifo.txt"
rm -f $CK

echo "  Logging in..."
LOGIN_RESP=$(curl -s -c $CK -X POST -H "Content-Type: application/json" \
  -d '{"email":"owner@bkj.id","password":"password123"}' \
  "$API_URL/api/auth/login")

if ! echo "$LOGIN_RESP" | grep -q "success"; then
  echo "  Login failed" >> $OUT_FILE
  exit 1
fi
echo "  Login successful."

# Use a wrapper for authenticated requests
api() {
  curl -s -b $CK "$API_URL$1"
}
api_post() {
  curl -s -b $CK -X POST -H "Content-Type: application/json" -d "$2" "$API_URL$1"
}

echo "  Fetching inventory and supplier..."
INV_ITEM_ID=$(api "/api/inventory?page=1&perPage=1" | jq -r '.data.items[0].id')
SUPPLIER_ID=$(api "/api/suppliers?page=1&perPage=1" | jq -r '.data.suppliers[0].id')
MENU_ITEM_ID=$(api "/api/menu/items?page=1&perPage=1" | jq -r '.data[0].id')

echo "  Inventory Item ID: $INV_ITEM_ID" >> $OUT_FILE
echo "  Supplier ID: $SUPPLIER_ID" >> $OUT_FILE
echo "  Menu Item ID: $MENU_ITEM_ID" >> $OUT_FILE

if [ -z "$INV_ITEM_ID" ] || [ "$SUPPLIER_ID" == "null" ] || [ "$MENU_ITEM_ID" == "null" ]; then
    echo "  Failed to retrieve initial data. Exiting." >> $OUT_FILE
    exit 1
fi

echo "  Creating two inventory batches..."
# Batch 1
PO_RESP_1=$(api_post "/api/purchase-orders" "{\"supplierId\":\"$SUPPLIER_ID\",\"items\":[{\"inventoryItemId\":\"$INV_ITEM_ID\",\"qtyOrdered\":10,\"unitCostCents\":10000}]}")
PO_ID_1=$(echo $PO_RESP_1 | jq -r '.data.purchaseOrder.id')
PO_ITEM_ID_1=$(echo $PO_RESP_1 | jq -r '.data.purchaseOrder.items[0].id')
api_post "/api/purchase-orders/$PO_ID_1/send" "" > /dev/null
api_post "/api/purchase-orders/$PO_ID_1/receive" "{\"items\":[{\"poItemId\":\"$PO_ITEM_ID_1\",\"qtyReceived\":10}]}" > /dev/null
echo "  Batch 1 (10 units @ 10000 cents) created via PO $PO_ID_1" >> $OUT_FILE

sleep 2 # Ensure timestamps are different

# Batch 2
PO_RESP_2=$(api_post "/api/purchase-orders" "{\"supplierId\":\"$SUPPLIER_ID\",\"items\":[{\"inventoryItemId\":\"$INV_ITEM_ID\",\"qtyOrdered\":20,\"unitCostCents\":12000}]}")
PO_ID_2=$(echo $PO_RESP_2 | jq -r '.data.purchaseOrder.id')
PO_ITEM_ID_2=$(echo $PO_RESP_2 | jq -r '.data.purchaseOrder.items[0].id')
api_post "/api/purchase-orders/$PO_ID_2/send" "" > /dev/null
api_post "/api/purchase-orders/$PO_ID_2/receive" "{\"items\":[{\"poItemId\":\"$PO_ITEM_ID_2\",\"qtyReceived\":20}]}" > /dev/null
echo "  Batch 2 (20 units @ 12000 cents) created via PO $PO_ID_2" >> $OUT_FILE

echo "  Fetching oldest batch ID before sale..."
BATCHES_BEFORE=$(api "/api/inventory/$INV_ITEM_ID/batches" | jq -r '.data[] | select(.qty_remaining > 0) | .id' | head -n 1)
OLDEST_BATCH_ID=$(echo "$BATCHES_BEFORE")
echo "  Oldest batch is $OLDEST_BATCH_ID" >> $OUT_FILE

echo "  Creating order to consume inventory..."
# Ensure the menu item has a recipe that uses the inventory item
api_post "/api/menu/items/$MENU_ITEM_ID/recipes" "{\"recipes\":[{\"inventoryItemId\":\"$INV_ITEM_ID\",\"quantity\":1}]}" > /dev/null

ORDER_RESP=$(api_post "/api/orders" "{\"type\":\"DINE_IN\"}")
ORDER_ID=$(echo $ORDER_RESP | jq -r '.data.order.id')
api_post "/api/orders/$ORDER_ID/items" "{\"menuItemId\":\"$MENU_ITEM_ID\",\"quantity\":3}" > /dev/null
api_post "/api/orders/$ORDER_ID/pay" "{\"provider\":\"CASH\",\"method\":\"CASH\",\"amountGiven\":50000}" > /dev/null
echo "  Order $ORDER_ID created, consuming 3 units." >> $OUT_FILE

sleep 2 # Allow time for consumption to process

echo "  Verifying consumption from oldest batch..."
CONSUMED_BATCH_INFO=$(api "/api/inventory/batches/$OLDEST_BATCH_ID")
QTY_REMAINING=$(echo "$CONSUMED_BATCH_INFO" | jq -r '.data.qty_remaining')
echo "  Oldest batch now has $QTY_REMAINING units remaining." >> $OUT_FILE

if [ "$(echo "$QTY_REMAINING < 7.1" | bc -l)" -eq 1 ] && [ "$(echo "$QTY_REMAINING > 6.9" | bc -l)" -eq 1 ]; then
    echo "  SUCCESS: Oldest batch was correctly consumed (10 - 3 = 7)." >> $OUT_FILE
else
    echo "  FAILURE: Oldest batch consumption is incorrect. Expected 7, got $QTY_REMAINING." >> $OUT_FILE
fi

# Cleanup
echo "  Cleaning up recipe..."
api_post "/api/menu/items/$MENU_ITEM_ID/recipes" "{\"recipes\":[]}" > /dev/null
echo "  FIFO test complete." >> $OUT_FILE
echo "" >> $OUT_FILE
