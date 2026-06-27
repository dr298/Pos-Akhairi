#!/bin/bash
API_URL="https://pos.akhairi.com"
COOKIE_JAR="/tmp/cookies.txt"

echo "--- Testing PO ---"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -b $COOKIE_JAR $API_URL/api/purchase-orders)
echo "PO Status: $HTTP_STATUS"
exit 0
