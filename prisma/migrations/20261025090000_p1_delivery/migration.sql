-- M12 P1: late deliveries and their new dates, late cancellation, partial collection and the
-- overdue mark on approvals.

-- AlterEnum
ALTER TYPE "ParticipationStatus" ADD VALUE 'cancelled_late';

-- AlterEnum
ALTER TYPE "PostingKind" ADD VALUE 'refund_late';

-- AlterEnum
ALTER TYPE "PickupStatus" ADD VALUE 'partly_ready';

-- AlterEnum
ALTER TYPE "CheckResult" ADD VALUE 'not_checked';

-- AlterTable
ALTER TABLE "allocations" ADD COLUMN     "cancelled_late_at" TIMESTAMPTZ,
ADD COLUMN     "collection_id" UUID;

-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "overdue_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "pickup_collections" (
    "id" UUID NOT NULL,
    "pickup_id" UUID NOT NULL,
    "collected_at" TIMESTAMPTZ NOT NULL,
    "collected_by_user_id" UUID,
    "method" TEXT NOT NULL,

    CONSTRAINT "pickup_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "late_deliveries" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "destination_key" TEXT NOT NULL,
    "delivery_date" TEXT NOT NULL,
    "original_expected_at" TIMESTAMPTZ NOT NULL,
    "new_expected_at" TIMESTAMPTZ,
    "reason" TEXT,
    "detected_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "late_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pickup_collections_pickup_id_idx" ON "pickup_collections"("pickup_id");

-- CreateIndex
CREATE UNIQUE INDEX "late_deliveries_shop_id_destination_key_delivery_date_key" ON "late_deliveries"("shop_id", "destination_key", "delivery_date");

-- AddForeignKey
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "pickup_collections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_collections" ADD CONSTRAINT "pickup_collections_pickup_id_fkey" FOREIGN KEY ("pickup_id") REFERENCES "pickups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "late_deliveries" ADD CONSTRAINT "late_deliveries_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

SELECT bk_secure_all_tables();

-- bk_secure_all_tables() grants the app role full access again, so restate the demo_settings limits
-- exactly as the p0 schema migration does.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "demo_settings" FROM bk_app;
GRANT UPDATE ("clock_offset_ms", "seed_version", "last_reset_at", "featured_product_id") ON "demo_settings" TO bk_app;
