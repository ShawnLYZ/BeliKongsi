-- CreateEnum
CREATE TYPE "ShopType" AS ENUM ('kopitiam', 'hawker', 'cafe', 'restaurant', 'bakery');

-- CreateEnum
CREATE TYPE "Fulfilment" AS ENUM ('pickup', 'door');

-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('shop', 'supplier', 'operator');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('owner', 'staff', 'supplier', 'ops');

-- CreateEnum
CREATE TYPE "SignInProvider" AS ENUM ('microsoft', 'google');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('active', 'paused');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('dairy', 'oil', 'flour', 'beverages', 'eggs', 'packaging');

-- CreateEnum
CREATE TYPE "UnitName" AS ENUM ('carton', 'tin', 'tray', 'sack', 'pack');

-- CreateEnum
CREATE TYPE "Cadence" AS ENUM ('weekly', 'fortnightly', 'monthly');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('scheduled', 'open', 'empty', 'failed', 'formed', 'ordered', 'confirmed', 'dispatched', 'at_hub', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "BasketStatus" AS ENUM ('draft', 'payment_pending', 'paid', 'skipped', 'expired');

-- CreateEnum
CREATE TYPE "LineSource" AS ENUM ('usual_list', 'staff', 'owner');

-- CreateEnum
CREATE TYPE "ParticipationSource" AS ENUM ('weekly_basket', 'catalogue', 'background_seed');

-- CreateEnum
CREATE TYPE "ParticipationStatus" AS ENUM ('active', 'cancelled', 'dropped_price_limit', 'refunded_failed', 'kept', 'refunded_round_cancelled', 'allocated', 'shorted', 'received', 'closed');

-- CreateEnum
CREATE TYPE "BaselineKind" AS ENUM ('usual', 'buy_alone');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('basket', 'join');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('duitnow_qr', 'fpx', 'balance_only');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'succeeded', 'failed', 'voided');

-- CreateEnum
CREATE TYPE "DeliveryFeeStatus" AS ENUM ('held', 'passed_to_partner', 'refunded');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('shop_balance', 'round_hold', 'delivery_fee_hold', 'supplier_payable', 'fee_revenue', 'logistics_payable', 'claims_expense', 'partner_cash');

-- CreateEnum
CREATE TYPE "PostingKind" AS ENUM ('payment_in', 'balance_applied', 'delivery_fee_in', 'refund_cancelled', 'refund_difference', 'refund_dropped', 'refund_failed', 'refund_round_cancelled', 'refund_shortfall', 'refund_delivery_fee', 'settlement_supplier', 'settlement_fee', 'settlement_logistics', 'supplier_payout', 'delivery_fee_to_partner', 'refund_claim');

-- CreateEnum
CREATE TYPE "SupplierOrderStatus" AS ENUM ('awaiting_ops', 'awaiting_supplier', 'confirmed', 'dispatched', 'settled', 'rejected_by_ops', 'rejected_by_supplier');

-- CreateEnum
CREATE TYPE "DestinationType" AS ENUM ('pickup_point', 'door');

-- CreateEnum
CREATE TYPE "ConsignmentStatus" AS ENUM ('planned', 'dispatched', 'arrived', 'out_for_delivery', 'delivered', 'completed');

-- CreateEnum
CREATE TYPE "PickupStatus" AS ENUM ('waiting', 'ready', 'out_for_delivery', 'collected', 'delivered', 'checked', 'closed');

-- CreateEnum
CREATE TYPE "CheckResult" AS ENUM ('all_received', 'issues');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('submitted', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('weekly_basket', 'supplier_order', 'supplier_confirmation', 'claim');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('person', 'system', 'ai');

-- CreateEnum
CREATE TYPE "AiRunKind" AS ENUM ('usual_list_text');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('succeeded', 'failed', 'saved_example');

-- CreateTable
CREATE TABLE "operators" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "hubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_points" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "opening_hours" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL,

    CONSTRAINT "pickup_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shops" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ShopType" NOT NULL,
    "address" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postcode" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "default_fulfilment" "Fulfilment" NOT NULL,
    "default_pickup_point_id" UUID,
    "is_background" BOOLEAN NOT NULL,
    "setup_completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "categories" "ProductCategory"[],
    "region" TEXT NOT NULL,
    "hub_id" UUID NOT NULL,
    "contact_name" TEXT NOT NULL,
    "contact_phone" TEXT NOT NULL,
    "status" "SupplierStatus" NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "sign_in_provider" "SignInProvider",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "org_type" "OrgType" NOT NULL,
    "shop_id" UUID,
    "supplier_id" UUID,
    "operator_id" UUID,
    "role" "Role" NOT NULL,
    "ended_at" TIMESTAMPTZ,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "short_name" TEXT NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "pack_description" TEXT NOT NULL,
    "unit_name" "UnitName" NOT NULL,
    "unit_weight_grams" INTEGER NOT NULL,
    "buy_alone_price_sen" INTEGER NOT NULL,
    "aliases" TEXT[],
    "pack_conversions" JSONB NOT NULL,
    "image_key" TEXT,
    "image_ai_generated" BOOLEAN NOT NULL,
    "cadence" "Cadence" NOT NULL,
    "schedule_anchor_week" TEXT NOT NULL,
    "cutoff_weekday" INTEGER NOT NULL DEFAULT 4,
    "cutoff_time" TEXT NOT NULL DEFAULT '20:00',
    "active" BOOLEAN NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_tiers" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "min_quantity" INTEGER NOT NULL,
    "unit_price_sen" INTEGER NOT NULL,

    CONSTRAINT "price_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "hub_id" UUID NOT NULL,
    "cycle_label" TEXT NOT NULL,
    "opens_at" TIMESTAMPTZ NOT NULL,
    "cutoff_at" TIMESTAMPTZ NOT NULL,
    "expected_ready_at" TIMESTAMPTZ NOT NULL,
    "tiers_snapshot" JSONB NOT NULL,
    "fee_bps" INTEGER NOT NULL,
    "buy_alone_price_sen" INTEGER NOT NULL,
    "unit_weight_grams" INTEGER NOT NULL,
    "status" "RoundStatus" NOT NULL,
    "final_tier" INTEGER,
    "final_unit_price_sen" INTEGER,
    "total_at_cutoff" INTEGER,
    "total_kept" INTEGER,
    "close_iterations" INTEGER,
    "closed_at" TIMESTAMPTZ,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usual_lists" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "usual_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usual_list_items" (
    "id" UUID NOT NULL,
    "usual_list_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "usual_price_sen" INTEGER,
    "price_limit_sen" INTEGER,

    CONSTRAINT "usual_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weekly_baskets" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "basket_week" TEXT NOT NULL,
    "status" "BasketStatus" NOT NULL,
    "deadline_at" TIMESTAMPTZ NOT NULL,
    "fulfilment" "Fulfilment" NOT NULL,
    "pickup_point_id" UUID,
    "approved_at" TIMESTAMPTZ,
    "approved_by_user_id" UUID,
    "skip_reason" TEXT,
    "first_opened_at" TIMESTAMPTZ,
    "approval_request_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weekly_baskets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "basket_lines" (
    "id" UUID NOT NULL,
    "basket_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price_limit_sen" INTEGER,
    "source" "LineSource" NOT NULL,
    "changed_by_user_id" UUID,
    "changed_by_role" "Role",
    "staff_added_quantity" INTEGER NOT NULL DEFAULT 0,
    "removed" BOOLEAN NOT NULL,
    "notice" TEXT,

    CONSTRAINT "basket_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "purpose" "PaymentPurpose" NOT NULL,
    "basket_id" UUID,
    "lines_total_sen" INTEGER NOT NULL,
    "delivery_fee_sen" INTEGER NOT NULL,
    "total_sen" INTEGER NOT NULL,
    "balance_applied_sen" INTEGER NOT NULL,
    "external_sen" INTEGER NOT NULL,
    "method" "PaymentMethod",
    "status" "PaymentStatus" NOT NULL,
    "partner_reference" TEXT,
    "deadline_at" TIMESTAMPTZ NOT NULL,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_lines" (
    "id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "basket_line_id" UUID,
    "quantity" INTEGER NOT NULL,
    "price_limit_sen" INTEGER,
    "fulfilment" "Fulfilment" NOT NULL,
    "destination_type" "DestinationType" NOT NULL,
    "pickup_point_id" UUID,
    "delivery_date" TEXT NOT NULL,
    "unit_goods_sen" INTEGER NOT NULL,
    "unit_fee_sen" INTEGER NOT NULL,
    "unit_shipping_sen" INTEGER NOT NULL,
    "unit_all_in_sen" INTEGER NOT NULL,
    "line_sen" INTEGER NOT NULL,
    "baseline_sen" INTEGER NOT NULL,
    "baseline_kind" "BaselineKind" NOT NULL,

    CONSTRAINT "payment_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participations" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "payment_line_id" UUID NOT NULL,
    "basket_line_id" UUID,
    "quantity" INTEGER NOT NULL,
    "price_limit_sen" INTEGER,
    "fulfilment" "Fulfilment" NOT NULL,
    "destination_type" "DestinationType" NOT NULL,
    "pickup_point_id" UUID,
    "delivery_date" TEXT NOT NULL,
    "joined_at" TIMESTAMPTZ NOT NULL,
    "source" "ParticipationSource" NOT NULL,
    "unit_shipping_sen" INTEGER NOT NULL,
    "baseline_sen" INTEGER NOT NULL,
    "baseline_kind" "BaselineKind" NOT NULL,
    "starting_all_in_sen" INTEGER NOT NULL,
    "paid_sen" INTEGER NOT NULL,
    "final_goods_sen" INTEGER,
    "final_fee_sen" INTEGER,
    "final_all_in_sen" INTEGER,
    "status" "ParticipationStatus" NOT NULL,
    "outcome_reason" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "participations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_fee_charges" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "delivery_date" TEXT NOT NULL,
    "amount_sen" INTEGER NOT NULL,
    "payment_id" UUID NOT NULL,
    "status" "DeliveryFeeStatus" NOT NULL,

    CONSTRAINT "delivery_fee_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "shop_id" UUID,
    "round_id" UUID,
    "supplier_id" UUID,
    "delivery_date" TEXT,
    "balance_sen" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_postings" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "from_account_id" UUID NOT NULL,
    "to_account_id" UUID NOT NULL,
    "amount_sen" INTEGER NOT NULL,
    "kind" "PostingKind" NOT NULL,
    "round_id" UUID,
    "participation_id" UUID,
    "payment_id" UUID,
    "claim_id" UUID,
    "supplier_order_id" UUID,
    "shop_id" UUID,
    "supplier_id" UUID,
    "memo" TEXT,

    CONSTRAINT "ledger_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_orders" (
    "id" UUID NOT NULL,
    "round_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "hub_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "accepted_quantity" INTEGER NOT NULL,
    "unit_price_sen" INTEGER NOT NULL,
    "total_sen" INTEGER NOT NULL,
    "status" "SupplierOrderStatus" NOT NULL,
    "ops_approval_id" UUID,
    "supplier_approval_id" UUID,
    "required_dispatch_date" TEXT NOT NULL,
    "expected_dispatch_date" TEXT,
    "confirmed_at" TIMESTAMPTZ,
    "dispatched_at" TIMESTAMPTZ,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hub_checks" (
    "id" UUID NOT NULL,
    "supplier_order_id" UUID NOT NULL,
    "good_units" INTEGER NOT NULL,
    "damaged_units" INTEGER NOT NULL,
    "notes" TEXT,
    "checked_by_user_id" UUID,
    "checked_at" TIMESTAMPTZ NOT NULL,
    "received_counted" INTEGER NOT NULL,
    "shortfall_units" INTEGER NOT NULL,
    "excess_units" INTEGER NOT NULL,
    "payout_sen" INTEGER NOT NULL,
    "payout_reference" TEXT NOT NULL,

    CONSTRAINT "hub_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocations" (
    "id" UUID NOT NULL,
    "participation_id" UUID NOT NULL,
    "allocated" INTEGER NOT NULL,
    "missing" INTEGER NOT NULL,
    "consignment_id" UUID,
    "pickup_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consignments" (
    "id" UUID NOT NULL,
    "hub_id" UUID NOT NULL,
    "destination_type" "DestinationType" NOT NULL,
    "pickup_point_id" UUID,
    "shop_id" UUID,
    "destination_key" TEXT NOT NULL,
    "delivery_date" TEXT NOT NULL,
    "wave" INTEGER NOT NULL,
    "status" "ConsignmentStatus" NOT NULL,
    "status_history" JSONB NOT NULL,
    "partner_reference" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickups" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "destination_type" "DestinationType" NOT NULL,
    "pickup_point_id" UUID,
    "destination_key" TEXT NOT NULL,
    "delivery_date" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "PickupStatus" NOT NULL,
    "ready_at" TIMESTAMPTZ,
    "collected_at" TIMESTAMPTZ,
    "collected_by_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pickups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_checks" (
    "id" UUID NOT NULL,
    "pickup_id" UUID NOT NULL,
    "submitted_by_user_id" UUID NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL,
    "result" "CheckResult" NOT NULL,

    CONSTRAINT "delivery_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_check_lines" (
    "id" UUID NOT NULL,
    "delivery_check_id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "expected" INTEGER NOT NULL,
    "received_good" INTEGER NOT NULL,
    "missing" INTEGER NOT NULL,
    "damaged" INTEGER NOT NULL,

    CONSTRAINT "delivery_check_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" UUID NOT NULL,
    "pickup_id" UUID NOT NULL,
    "delivery_check_line_id" UUID,
    "storage_key" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "uploaded_by_user_id" UUID NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL,
    "delete_after" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" UUID NOT NULL,
    "delivery_check_id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "total_refund_sen" INTEGER NOT NULL,
    "status" "ClaimStatus" NOT NULL,
    "approval_request_id" UUID,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_lines" (
    "id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "allocation_id" UUID NOT NULL,
    "missing" INTEGER NOT NULL,
    "damaged" INTEGER NOT NULL,
    "refund_sen" INTEGER NOT NULL,

    CONSTRAINT "claim_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "shop_id" UUID,
    "supplier_id" UUID,
    "assignee_role" "Role" NOT NULL,
    "amount_sen" INTEGER,
    "summary" TEXT NOT NULL,
    "why_needed" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "proposed_by_type" "ActorType" NOT NULL,
    "proposed_by_user_id" UUID,
    "status" "ApprovalStatus" NOT NULL,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ,
    "reason" TEXT,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "shop_id" UUID,
    "supplier_id" UUID,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "whatsapp_text" TEXT NOT NULL,
    "dedupe_key" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_log_entries" (
    "seq" BIGINT NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "actor_user_id" UUID,
    "actor_role" "Role",
    "actor_type" "ActorType" NOT NULL,
    "shop_id" UUID,
    "supplier_id" UUID,
    "operator_scope" BOOLEAN NOT NULL,
    "action" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ai_metadata" JSONB,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "activity_log_entries_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "activity_chain_head" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_seq" BIGINT NOT NULL,
    "last_hash" TEXT NOT NULL,

    CONSTRAINT "activity_chain_head_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_suggestion_runs" (
    "id" UUID NOT NULL,
    "shop_id" UUID NOT NULL,
    "kind" "AiRunKind" NOT NULL,
    "redacted_input" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" "AiRunStatus" NOT NULL,
    "suggestions" JSONB NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ,
    "change_summary" JSONB,

    CONSTRAINT "ai_suggestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_events" (
    "id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "type" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "integration_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demo_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "demo_mode" BOOLEAN NOT NULL,
    "clock_offset_ms" BIGINT NOT NULL,
    "seed_version" TEXT NOT NULL,
    "last_reset_at" TIMESTAMPTZ,
    "featured_product_id" UUID,

    CONSTRAINT "demo_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("scope","key")
);

-- CreateTable
CREATE TABLE "rate_limit_hits" (
    "id" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "rate_limit_hits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "price_tiers_product_id_position_key" ON "price_tiers"("product_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "usual_lists_shop_id_key" ON "usual_lists"("shop_id");

-- CreateIndex
CREATE UNIQUE INDEX "usual_list_items_usual_list_id_product_id_key" ON "usual_list_items"("usual_list_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_baskets_shop_id_basket_week_key" ON "weekly_baskets"("shop_id", "basket_week");

-- CreateIndex
CREATE UNIQUE INDEX "basket_lines_basket_id_product_id_key" ON "basket_lines"("basket_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "participations_payment_line_id_key" ON "participations"("payment_line_id");

-- CreateIndex
CREATE INDEX "participations_round_id_status_idx" ON "participations"("round_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_fee_charges_shop_id_delivery_date_key" ON "delivery_fee_charges"("shop_id", "delivery_date");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_key_key" ON "ledger_accounts"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_postings_seq_key" ON "ledger_postings"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_orders_round_id_key" ON "supplier_orders"("round_id");

-- CreateIndex
CREATE UNIQUE INDEX "hub_checks_supplier_order_id_key" ON "hub_checks"("supplier_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "allocations_participation_id_key" ON "allocations"("participation_id");

-- CreateIndex
CREATE UNIQUE INDEX "consignments_hub_id_destination_key_delivery_date_wave_key" ON "consignments"("hub_id", "destination_key", "delivery_date", "wave");

-- CreateIndex
CREATE UNIQUE INDEX "pickups_shop_id_destination_key_delivery_date_key" ON "pickups"("shop_id", "destination_key", "delivery_date");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_checks_pickup_id_key" ON "delivery_checks"("pickup_id");

-- CreateIndex
CREATE UNIQUE INDEX "claims_delivery_check_id_key" ON "claims"("delivery_check_id");

-- CreateIndex
CREATE INDEX "approval_requests_status_assignee_role_idx" ON "approval_requests"("status", "assignee_role");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_dedupe_key_key" ON "notifications"("dedupe_key");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_log_entries_shop_id_idx" ON "activity_log_entries"("shop_id");

-- CreateIndex
CREATE INDEX "activity_log_entries_supplier_id_idx" ON "activity_log_entries"("supplier_id");

-- CreateIndex
CREATE INDEX "activity_log_entries_actor_user_id_idx" ON "activity_log_entries"("actor_user_id");

-- CreateIndex
CREATE INDEX "activity_log_entries_subject_type_subject_id_idx" ON "activity_log_entries"("subject_type", "subject_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_events_seq_key" ON "integration_events"("seq");

-- CreateIndex
CREATE INDEX "rate_limit_hits_bucket_at_idx" ON "rate_limit_hits"("bucket", "at");

-- AddForeignKey
ALTER TABLE "shops" ADD CONSTRAINT "shops_default_pickup_point_id_fkey" FOREIGN KEY ("default_pickup_point_id") REFERENCES "pickup_points"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_tiers" ADD CONSTRAINT "price_tiers_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usual_lists" ADD CONSTRAINT "usual_lists_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usual_list_items" ADD CONSTRAINT "usual_list_items_usual_list_id_fkey" FOREIGN KEY ("usual_list_id") REFERENCES "usual_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usual_list_items" ADD CONSTRAINT "usual_list_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_baskets" ADD CONSTRAINT "weekly_baskets_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "basket_lines" ADD CONSTRAINT "basket_lines_basket_id_fkey" FOREIGN KEY ("basket_id") REFERENCES "weekly_baskets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_lines" ADD CONSTRAINT "payment_lines_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participations" ADD CONSTRAINT "participations_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "participations" ADD CONSTRAINT "participations_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_from_account_id_fkey" FOREIGN KEY ("from_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_to_account_id_fkey" FOREIGN KEY ("to_account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_orders" ADD CONSTRAINT "supplier_orders_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hub_checks" ADD CONSTRAINT "hub_checks_supplier_order_id_fkey" FOREIGN KEY ("supplier_order_id") REFERENCES "supplier_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_checks" ADD CONSTRAINT "delivery_checks_pickup_id_fkey" FOREIGN KEY ("pickup_id") REFERENCES "pickups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_check_lines" ADD CONSTRAINT "delivery_check_lines_delivery_check_id_fkey" FOREIGN KEY ("delivery_check_id") REFERENCES "delivery_checks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_check_lines" ADD CONSTRAINT "delivery_check_lines_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_pickup_id_fkey" FOREIGN KEY ("pickup_id") REFERENCES "pickups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photos" ADD CONSTRAINT "photos_delivery_check_line_id_fkey" FOREIGN KEY ("delivery_check_line_id") REFERENCES "delivery_check_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_delivery_check_id_fkey" FOREIGN KEY ("delivery_check_id") REFERENCES "delivery_checks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_lines" ADD CONSTRAINT "claim_lines_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_lines" ADD CONSTRAINT "claim_lines_allocation_id_fkey" FOREIGN KEY ("allocation_id") REFERENCES "allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written constraints

-- Only one open Kongsi per product.
CREATE UNIQUE INDEX "rounds_one_open_per_product" ON "rounds"("product_id") WHERE "status" = 'open';

-- A pickup code is unique per destination while the pickup is still live.
CREATE UNIQUE INDEX "pickups_open_code_per_destination" ON "pickups"("destination_key", "code") WHERE "status" <> 'closed';

-- Shop balance, round hold and delivery fee hold never go negative.
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_balance_not_negative"
  CHECK ("kind" NOT IN ('shop_balance', 'round_hold', 'delivery_fee_hold') OR "balance_sen" >= 0);

ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_amount_positive" CHECK ("amount_sen" > 0);

-- Append-only tables: even the table owner cannot update or delete rows.
CREATE FUNCTION bk_reject_change() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END
$$;

CREATE TRIGGER activity_log_entries_append_only
  BEFORE UPDATE OR DELETE ON "activity_log_entries"
  FOR EACH ROW EXECUTE FUNCTION bk_reject_change();

CREATE TRIGGER ledger_postings_append_only
  BEFORE UPDATE OR DELETE ON "ledger_postings"
  FOR EACH ROW EXECUTE FUNCTION bk_reject_change();

-- Single-row tables.
ALTER TABLE "activity_chain_head" ADD CONSTRAINT "activity_chain_head_single_row" CHECK ("id" = 1);
ALTER TABLE "demo_settings" ADD CONSTRAINT "demo_settings_single_row" CHECK ("id" = 1);
INSERT INTO "activity_chain_head" ("id", "last_seq", "last_hash") VALUES (1, 0, repeat('0', 64));
INSERT INTO "demo_settings" ("id", "demo_mode", "clock_offset_ms", "seed_version") VALUES (1, true, 0, 'none');

-- Demo reset: wipes business data while demo mode is on. Runs as the owner so the app role
-- needs no TRUNCATE right on any table.
CREATE FUNCTION bk_demo_reset() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  table_list text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.demo_settings WHERE demo_mode) THEN
    RAISE EXCEPTION 'demo mode is off';
  END IF;

  SELECT string_agg(format('public.%I', tablename), ', ') INTO table_list
  FROM pg_tables
  WHERE schemaname = 'public'
    AND tablename NOT IN ('_prisma_migrations', 'demo_settings', 'activity_chain_head');

  EXECUTE 'TRUNCATE ' || table_list || ' RESTART IDENTITY CASCADE';

  UPDATE public.activity_chain_head SET last_seq = 0, last_hash = repeat('0', 64) WHERE id = 1;
END
$$;

REVOKE ALL ON FUNCTION bk_demo_reset() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bk_demo_reset() TO bk_app;

SELECT bk_secure_all_tables();

-- The app role may move the demo clock and re-seed, but never switch demo mode off.
-- Insert and delete are revoked too, so the row cannot be deleted and re-inserted with demo mode off.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "demo_settings" FROM bk_app;
GRANT UPDATE ("clock_offset_ms", "seed_version", "last_reset_at", "featured_product_id") ON "demo_settings" TO bk_app;
