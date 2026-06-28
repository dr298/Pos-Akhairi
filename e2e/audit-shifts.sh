#!/bin/bash
API_URL="https://pos-uat.akhairi.com"
COOKIE_JAR="/tmp/cookies.txt"

echo "--- Testing Shift ---"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -b $COOKIE_JAR $API_URL/api/shifts/current)
echo "Shift Status: $HTTP_STATUS"
exit 0
