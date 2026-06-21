-- Sprint 10: Remove online ordering & delivery integration
-- Per user request 2026-06-21: "hapus fitur delivery order (integrasi
-- gofood shopefood dan grabfood), gajadi dipake".
--
-- This migration removes the DELIVERY value from the OrderType enum.
-- We do NOT drop the channel_orders / channel_configs / etc. tables here
-- because the user said "remove the feature" not "remove the schema".
-- The tables become dormant (no API/UI access); can be dropped in a
-- later cleanup migration if desired.
--
-- Existing DELIVERY orders (4 rows in production) are migrated to
-- TAKEAWAY since that's the closest equivalent (customer picks up
-- the food themselves instead of getting it delivered by an aggregator).
--
-- Steps:
-- 1. Add new enum with DELIVERY removed.
-- 2. Migrate any DELIVERY orders to TAKEAWAY.
-- 3. Change the orders.type column to the new enum.
-- 4. Drop the old enum (now unused).

-- Step 1: Create the new enum without DELIVERY.
CREATE TYPE "OrderType_new" AS ENUM ('DINE_IN', 'TAKEAWAY', 'KIOSK');

-- Step 2 + 3: Migrate rows + switch the column type in a single ALTER.
-- The USING clause casts each value to the new type; DELIVERY rows
-- become TAKEAWAY.
ALTER TABLE "orders"
    ALTER COLUMN "type" DROP DEFAULT,
    ALTER COLUMN "type" TYPE "OrderType_new" USING (
        CASE WHEN "type" = 'DELIVERY'::"OrderType" THEN 'TAKEAWAY'::"OrderType_new"
             ELSE "type"::text::"OrderType_new"
        END
    ),
    ALTER COLUMN "type" SET DEFAULT 'DINE_IN'::"OrderType_new";

-- Step 4: Drop the old enum (no longer referenced).
DROP TYPE "OrderType";
ALTER TYPE "OrderType_new" RENAME TO "OrderType";
