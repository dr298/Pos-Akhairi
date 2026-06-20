-- Sprint 4.2: commission_reports table
-- Per-branch, per-channel, per-day commission reconciliation.
-- Stores both our local numbers and the aggregator's reported numbers;
-- deltaCents = local - aggregator (negative = we're paying more than they charged).

-- CreateTable
CREATE TABLE "commission_reports" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "businessDate" DATE NOT NULL,
    "localCommissionCents" INTEGER NOT NULL DEFAULT 0,
    "localOrderCount" INTEGER NOT NULL DEFAULT 0,
    "localBilledCents" INTEGER,
    "aggregatorCommissionCents" INTEGER,
    "aggregatorOrderCount" INTEGER,
    "aggregatorBilledCents" INTEGER,
    "deltaCents" INTEGER,
    "status" TEXT NOT NULL,
    "notes" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_reports_branchId_businessDate_idx" ON "commission_reports"("branchId", "businessDate");

-- CreateIndex
CREATE INDEX "commission_reports_status_idx" ON "commission_reports"("status");

-- CreateIndex
CREATE UNIQUE INDEX "commission_reports_branchId_channel_businessDate_key" ON "commission_reports"("branchId", "channel", "businessDate");

-- AddForeignKey
ALTER TABLE "commission_reports" ADD CONSTRAINT "commission_reports_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
