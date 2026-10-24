-- M12 P1-8: one delivery check per collection (O7). A pickup can now be collected in parts, so
-- its checks hang off its collections instead of the pickup itself.

-- DropIndex
DROP INDEX "delivery_checks_pickup_id_key";

-- AlterTable
ALTER TABLE "delivery_checks" ADD COLUMN     "collection_id" UUID;

-- Backfill: every pickup already checked, collected or delivered was handed over in one go. Give
-- it one collection (by the system, at the hand-over time or else the check's time) holding its
-- live allocations and its check.
INSERT INTO "pickup_collections" ("id", "pickup_id", "collected_at", "collected_by_user_id", "method")
SELECT gen_random_uuid(), p."id", COALESCE(p."collected_at", dc."submitted_at"), p."collected_by_user_id", 'system'
FROM "pickups" p
LEFT JOIN "delivery_checks" dc ON dc."pickup_id" = p."id"
WHERE dc."id" IS NOT NULL OR p."collected_at" IS NOT NULL;

UPDATE "allocations" a
SET "collection_id" = pc."id"
FROM "pickup_collections" pc
WHERE pc."pickup_id" = a."pickup_id" AND a."collection_id" IS NULL AND a."cancelled_late_at" IS NULL;

UPDATE "delivery_checks" dc
SET "collection_id" = pc."id"
FROM "pickup_collections" pc
WHERE pc."pickup_id" = dc."pickup_id";

ALTER TABLE "delivery_checks" ALTER COLUMN "collection_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "delivery_checks_collection_id_key" ON "delivery_checks"("collection_id");

-- CreateIndex
CREATE INDEX "delivery_checks_pickup_id_idx" ON "delivery_checks"("pickup_id");

-- AddForeignKey
ALTER TABLE "delivery_checks" ADD CONSTRAINT "delivery_checks_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "pickup_collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

SELECT bk_secure_all_tables();

-- bk_secure_all_tables() grants the app role full access again, so restate the demo_settings limits
-- exactly as the p0 schema migration does.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "demo_settings" FROM bk_app;
GRANT UPDATE ("clock_offset_ms", "seed_version", "last_reset_at", "featured_product_id") ON "demo_settings" TO bk_app;
