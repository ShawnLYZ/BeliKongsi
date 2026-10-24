-- M13 P1-13: a price-list import is an AI run that belongs to a supplier, not a shop.

-- AlterTable
ALTER TABLE "ai_suggestion_runs" ALTER COLUMN "shop_id" DROP NOT NULL,
ADD COLUMN "supplier_id" UUID;

-- Every run belongs to exactly one shop or one supplier.
ALTER TABLE "ai_suggestion_runs" ADD CONSTRAINT "ai_suggestion_runs_one_owner"
  CHECK (("shop_id" IS NULL) <> ("supplier_id" IS NULL));

-- CreateIndex
CREATE INDEX "ai_suggestion_runs_supplier_id_idx" ON "ai_suggestion_runs"("supplier_id");

-- AddForeignKey
ALTER TABLE "ai_suggestion_runs" ADD CONSTRAINT "ai_suggestion_runs_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
