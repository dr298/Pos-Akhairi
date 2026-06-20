-- Sprint 4: Daily close table for EOD auto-close + commission reconciliation
-- Creates: daily_closes (id, branch_id, shift_id, business_date, totals, etc.)

-- CreateTable
CREATE TABLE "daily_closes" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "shift_id" TEXT,
    "business_date" DATE NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMP(3),
    "closed_by" TEXT,
    "orders_total" INTEGER NOT NULL DEFAULT 0,
    "orders_voided" INTEGER NOT NULL DEFAULT 0,
    "orders_refunded" INTEGER NOT NULL DEFAULT 0,
    "gross_cents" INTEGER NOT NULL DEFAULT 0,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "net_cents" INTEGER NOT NULL DEFAULT 0,
    "delivery_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "service_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "commission_cents" INTEGER NOT NULL DEFAULT 0,
    "net_after_comm_cents" INTEGER NOT NULL DEFAULT 0,
    "by_payment_json" JSONB NOT NULL DEFAULT '{}',
    "by_channel_json" JSONB NOT NULL DEFAULT '{}',
    "aggregator_report_json" JSONB,
    "commission_reported_cents" INTEGER,
    "commission_variance_cents" INTEGER,
    "reconciled_at" TIMESTAMP(3),
    "reconciliation_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_closes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_closes_business_date_idx" ON "daily_closes"("business_date");

-- CreateIndex
CREATE INDEX "daily_closes_status_idx" ON "daily_closes"("status");

-- CreateIndex (unique constraint for @@unique([branchId, businessDate]))
CREATE UNIQUE INDEX "daily_closes_branch_id_business_date_key" ON "daily_closes"("branch_id", "business_date");

-- AddForeignKey
ALTER TABLE "daily_closes" ADD CONSTRAINT "daily_closes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_closes" ADD CONSTRAINT "daily_closes_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
