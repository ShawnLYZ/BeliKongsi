-- AlterTable: a background shop has no user, so the system submits its delivery check (PRD 10).
ALTER TABLE "delivery_checks" ALTER COLUMN "submitted_by_user_id" DROP NOT NULL;
