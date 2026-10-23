-- M11 P1: the auto-approve rule with its simulated AutoDebit mandate, balance withdrawals, the
-- data-deletion approval, and the shop columns for time saved and anonymisation.

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'auto_debit';
ALTER TYPE "PostingKind" ADD VALUE 'withdrawal';
ALTER TYPE "ApprovalType" ADD VALUE 'data_deletion';

-- AlterTable
ALTER TABLE "shops" ADD COLUMN "old_minutes_per_week" INTEGER,
ADD COLUMN "anonymised_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "auto_approve_rules" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "cap_sen" INTEGER NOT NULL DEFAULT 50000,
    "require_below_usual" BOOLEAN NOT NULL DEFAULT true,
    "mandate_reference" TEXT,
    "mandate_agreed_at" TIMESTAMPTZ,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "auto_approve_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "withdrawals" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "amount_sen" INTEGER NOT NULL,
    "partner_reference" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auto_approve_rules_shop_id_key" ON "auto_approve_rules"("shop_id");

-- AddForeignKey
ALTER TABLE "auto_approve_rules" ADD CONSTRAINT "auto_approve_rules_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

SELECT bk_secure_all_tables();

-- bk_secure_all_tables() grants the app role full access again, so restate the demo_settings limits
-- exactly as the p0 schema migration does.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "demo_settings" FROM bk_app;
GRANT UPDATE ("clock_offset_ms", "seed_version", "last_reset_at", "featured_product_id") ON "demo_settings" TO bk_app;
