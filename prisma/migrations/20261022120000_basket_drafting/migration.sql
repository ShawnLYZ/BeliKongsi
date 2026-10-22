-- AlterTable: a basket records when its draft was made from the usual list.
ALTER TABLE "weekly_baskets" ADD COLUMN "drafted_at" TIMESTAMPTZ;

-- AlterTable: a staff-added line has no round until the basket is drafted.
ALTER TABLE "basket_lines" ALTER COLUMN "round_id" DROP NOT NULL;

SELECT bk_secure_all_tables();

-- bk_secure_all_tables() grants the app role full access again, so restate the demo_settings limits
-- exactly as the p0 schema migration does.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "demo_settings" FROM bk_app;
GRANT UPDATE ("clock_offset_ms", "seed_version", "last_reset_at", "featured_product_id") ON "demo_settings" TO bk_app;
