-- AlterTable: a payment records which door delivery dates its delivery fee covers (PRD 6.9), so the
-- fee is held per date when the payment succeeds.
ALTER TABLE "payments" ADD COLUMN "delivery_fee_dates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

SELECT bk_secure_all_tables();

-- bk_secure_all_tables() grants the app role full access again, so restate the demo_settings limits
-- exactly as the p0 schema migration does.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "demo_settings" FROM bk_app;
GRANT UPDATE ("clock_offset_ms", "seed_version", "last_reset_at", "featured_product_id") ON "demo_settings" TO bk_app;
