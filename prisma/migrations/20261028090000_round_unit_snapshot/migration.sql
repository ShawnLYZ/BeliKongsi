-- M13 P1 (story 115): a round freezes its product's unit and pack when it opens, so a supplier's
-- later edit cannot change what an open round's quantities mean.

-- AlterTable
ALTER TABLE "rounds" ADD COLUMN "unit_name" "UnitName",
ADD COLUMN "pack_description" TEXT;

-- Existing rounds take their product's current unit and pack.
UPDATE "rounds" AS r
SET "unit_name" = p."unit_name", "pack_description" = p."pack_description"
FROM "products" AS p
WHERE p."id" = r."product_id";

ALTER TABLE "rounds" ALTER COLUMN "unit_name" SET NOT NULL,
ALTER COLUMN "pack_description" SET NOT NULL;
