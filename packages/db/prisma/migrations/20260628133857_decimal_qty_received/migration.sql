-- AlterTable
ALTER TABLE "purchase_order_items" ALTER COLUMN "qty_received" DROP DEFAULT,
ALTER COLUMN "qty_received" TYPE DECIMAL(12,4) USING "qty_received"::DECIMAL(12,4),
ALTER COLUMN "qty_received" SET DEFAULT 0;
