-- Sprint 3: delivery aggregator tables
-- This migration was applied via db push; recreating the migration file
-- to keep migration history consistent.

CREATE TYPE "Channel" AS ENUM ('POS', 'GOFOOD', 'GRABFOOD', 'SHOPEEFOOD', 'MANUAL');

CREATE TYPE "ChannelOrderStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'PREPARING', 'READY', 'PICKED_UP', 'DELIVERED', 'CANCELLED', 'REFUNDED');

CREATE TABLE "channel_configs" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "store_id" TEXT,
    "api_key_encrypted" TEXT,
    "api_secret_encrypted" TEXT,
    "webhook_secret" TEXT,
    "poll_interval_sec" INTEGER NOT NULL DEFAULT 60,
    "last_polled_at" TIMESTAMP(3),
    "config_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_configs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "channel_orders" (
    "id" TEXT NOT NULL,
    "branch_id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "channel_config_id" TEXT,
    "external_id" TEXT NOT NULL,
    "external_ref" TEXT,
    "status" "ChannelOrderStatus" NOT NULL DEFAULT 'PENDING',
    "customer_name" TEXT,
    "customer_phone" TEXT,
    "delivery_address" TEXT,
    "delivery_lat" DECIMAL(9,6),
    "delivery_lng" DECIMAL(9,6),
    "delivery_notes" TEXT,
    "driver_name" TEXT,
    "driver_phone" TEXT,
    "subtotal_cents" INTEGER NOT NULL DEFAULT 0,
    "delivery_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "service_fee_cents" INTEGER NOT NULL DEFAULT 0,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "commission_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL DEFAULT 0,
    "order_id" TEXT,
    "items_json" JSONB NOT NULL,
    "raw_payload" JSONB,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted_at" TIMESTAMP(3),
    "prepared_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "channel_order_events" (
    "id" TEXT NOT NULL,
    "channel_order_id" TEXT NOT NULL,
    "status" "ChannelOrderStatus" NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'SYSTEM',
    "note" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_order_events_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "channel_configs_branch_id_channel_key" ON "channel_configs"("branch_id", "channel");
CREATE INDEX "channel_configs_channel_enabled_idx" ON "channel_configs"("channel", "enabled");

CREATE UNIQUE INDEX "channel_orders_channel_external_id_key" ON "channel_orders"("channel", "external_id");
CREATE INDEX "channel_orders_branch_id_status_idx" ON "channel_orders"("branch_id", "status");
CREATE INDEX "channel_orders_channel_status_idx" ON "channel_orders"("channel", "status");
CREATE INDEX "channel_orders_order_id_idx" ON "channel_orders"("order_id");

CREATE INDEX "channel_order_events_channel_order_id_created_at_idx" ON "channel_order_events"("channel_order_id", "created_at");

-- Foreign keys
ALTER TABLE "channel_configs" ADD CONSTRAINT "channel_configs_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "channel_orders" ADD CONSTRAINT "channel_orders_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "channel_orders" ADD CONSTRAINT "channel_orders_channel_config_id_fkey" FOREIGN KEY ("channel_config_id") REFERENCES "channel_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "channel_orders" ADD CONSTRAINT "channel_orders_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "channel_order_events" ADD CONSTRAINT "channel_order_events_channel_order_id_fkey" FOREIGN KEY ("channel_order_id") REFERENCES "channel_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
