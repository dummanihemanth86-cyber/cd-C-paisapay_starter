-- P2P UPI matching records. Existing withdrawal and wallet history is preserved.
CREATE TABLE "p2p_withdrawal_offers" (
  "id" UUID NOT NULL,
  "reference_id" TEXT NOT NULL,
  "user_id" UUID NOT NULL,
  "amount_paise" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "payment_method" TEXT NOT NULL DEFAULT 'UPI',
  "payee_vpa" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "matched_buyer_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "p2p_withdrawal_offers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "p2p_withdrawal_offers_amount_positive" CHECK ("amount_paise" > 0),
  CONSTRAINT "p2p_withdrawal_offers_currency_inr" CHECK ("currency" = 'INR')
);
CREATE UNIQUE INDEX "p2p_withdrawal_offers_reference_id_key" ON "p2p_withdrawal_offers"("reference_id");
CREATE UNIQUE INDEX "p2p_withdrawal_offers_idempotency_key_key" ON "p2p_withdrawal_offers"("idempotency_key");
CREATE INDEX "p2p_withdrawal_offers_status_amount_paise_created_at_idx" ON "p2p_withdrawal_offers"("status", "amount_paise", "created_at");
CREATE INDEX "p2p_withdrawal_offers_user_id_created_at_idx" ON "p2p_withdrawal_offers"("user_id", "created_at");
ALTER TABLE "p2p_withdrawal_offers"
  ADD CONSTRAINT "p2p_withdrawal_offers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "p2p_withdrawal_offers_matched_buyer_id_fkey" FOREIGN KEY ("matched_buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "p2p_deposit_orders" (
  "id" UUID NOT NULL,
  "reference_id" TEXT NOT NULL,
  "buyer_user_id" UUID NOT NULL,
  "seller_user_id" UUID NOT NULL,
  "withdrawal_offer_id" UUID NOT NULL,
  "amount_paise" BIGINT NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'INR',
  "status" TEXT NOT NULL DEFAULT 'MATCHED',
  "idempotency_key" TEXT NOT NULL,
  "provider_reference" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "p2p_deposit_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "p2p_deposit_orders_amount_positive" CHECK ("amount_paise" > 0),
  CONSTRAINT "p2p_deposit_orders_currency_inr" CHECK ("currency" = 'INR'),
  CONSTRAINT "p2p_deposit_orders_distinct_users" CHECK ("buyer_user_id" <> "seller_user_id")
);
CREATE UNIQUE INDEX "p2p_deposit_orders_reference_id_key" ON "p2p_deposit_orders"("reference_id");
CREATE UNIQUE INDEX "p2p_deposit_orders_withdrawal_offer_id_key" ON "p2p_deposit_orders"("withdrawal_offer_id");
CREATE UNIQUE INDEX "p2p_deposit_orders_idempotency_key_key" ON "p2p_deposit_orders"("idempotency_key");
CREATE UNIQUE INDEX "p2p_deposit_orders_provider_reference_key" ON "p2p_deposit_orders"("provider_reference");
CREATE INDEX "p2p_deposit_orders_buyer_user_id_created_at_idx" ON "p2p_deposit_orders"("buyer_user_id", "created_at");
CREATE INDEX "p2p_deposit_orders_seller_user_id_created_at_idx" ON "p2p_deposit_orders"("seller_user_id", "created_at");
CREATE INDEX "p2p_deposit_orders_status_created_at_idx" ON "p2p_deposit_orders"("status", "created_at");
ALTER TABLE "p2p_deposit_orders"
  ADD CONSTRAINT "p2p_deposit_orders_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "p2p_deposit_orders_seller_user_id_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "p2p_deposit_orders_withdrawal_offer_id_fkey" FOREIGN KEY ("withdrawal_offer_id") REFERENCES "p2p_withdrawal_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "p2p_payment_claims" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "transaction_reference" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "reviewed_by_user_id" UUID,
  "review_reason" TEXT,
  "evidence_reference" TEXT,
  "verified_amount_paise" BIGINT,
  "verified_currency" CHAR(3),
  "receiver_confirmed" BOOLEAN NOT NULL DEFAULT FALSE,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "p2p_payment_claims_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "p2p_payment_claims_transaction_reference_key" ON "p2p_payment_claims"("transaction_reference");
CREATE INDEX "p2p_payment_claims_order_id_created_at_idx" ON "p2p_payment_claims"("order_id", "created_at");
CREATE INDEX "p2p_payment_claims_status_created_at_idx" ON "p2p_payment_claims"("status", "created_at");
ALTER TABLE "p2p_payment_claims"
  ADD CONSTRAINT "p2p_payment_claims_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "p2p_deposit_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "p2p_payment_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "p2p_payment_claims_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
