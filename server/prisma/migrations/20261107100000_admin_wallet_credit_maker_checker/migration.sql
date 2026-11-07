CREATE TYPE "AdminApprovalStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED');

CREATE TABLE "admin_wallet_credit_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "target_user_id" UUID NOT NULL,
    "maker_user_id" UUID NOT NULL,
    "checker_user_id" UUID,
    "amount_paise" BIGINT NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" "AdminApprovalStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "idempotency_key" VARCHAR(100) NOT NULL,
    "decision_reason" VARCHAR(500),
    "ledger_transaction_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),
    CONSTRAINT "admin_wallet_credit_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_wallet_credit_requests_amount_check" CHECK ("amount_paise" >= 10000 AND "amount_paise" <= 1000000),
    CONSTRAINT "admin_wallet_credit_requests_maker_checker_check" CHECK ("checker_user_id" IS NULL OR "checker_user_id" <> "maker_user_id"),
    CONSTRAINT "admin_wallet_credit_requests_state_check" CHECK (
      ("status" = 'PENDING_APPROVAL' AND "checker_user_id" IS NULL AND "ledger_transaction_id" IS NULL AND "decided_at" IS NULL) OR
      ("status" = 'APPROVED' AND "checker_user_id" IS NOT NULL AND "ledger_transaction_id" IS NOT NULL AND "decided_at" IS NOT NULL) OR
      ("status" = 'REJECTED' AND "checker_user_id" IS NOT NULL AND "ledger_transaction_id" IS NULL AND "decided_at" IS NOT NULL)
    )
);

CREATE TABLE "admin_wallet_funding_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "maker_user_id" UUID NOT NULL,
    "checker_user_id" UUID,
    "amount_paise" BIGINT NOT NULL,
    "source_account_label" VARCHAR(100) NOT NULL,
    "external_reference_hash" CHAR(64) NOT NULL,
    "evidence_reference" VARCHAR(160) NOT NULL,
    "evidence_sha256" CHAR(64) NOT NULL,
    "statement_date" DATE NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" "AdminApprovalStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "idempotency_key" VARCHAR(100) NOT NULL,
    "decision_reason" VARCHAR(500),
    "ledger_transaction_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),
    CONSTRAINT "admin_wallet_funding_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "admin_wallet_funding_requests_amount_check" CHECK ("amount_paise" > 0 AND "amount_paise" <= 100000000000),
    CONSTRAINT "admin_wallet_funding_requests_hash_check" CHECK ("external_reference_hash" ~ '^[0-9a-f]{64}$' AND "evidence_sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "admin_wallet_funding_requests_maker_checker_check" CHECK ("checker_user_id" IS NULL OR "checker_user_id" <> "maker_user_id"),
    CONSTRAINT "admin_wallet_funding_requests_state_check" CHECK (
      ("status" = 'PENDING_APPROVAL' AND "checker_user_id" IS NULL AND "ledger_transaction_id" IS NULL AND "decided_at" IS NULL) OR
      ("status" = 'APPROVED' AND "checker_user_id" IS NOT NULL AND "ledger_transaction_id" IS NOT NULL AND "decided_at" IS NOT NULL) OR
      ("status" = 'REJECTED' AND "checker_user_id" IS NOT NULL AND "ledger_transaction_id" IS NULL AND "decided_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "admin_wallet_credit_requests_idempotency_key_key" ON "admin_wallet_credit_requests"("idempotency_key");
CREATE UNIQUE INDEX "admin_wallet_credit_requests_ledger_transaction_id_key" ON "admin_wallet_credit_requests"("ledger_transaction_id");
CREATE INDEX "admin_wallet_credit_requests_status_created_at_idx" ON "admin_wallet_credit_requests"("status", "created_at");
CREATE INDEX "admin_wallet_credit_requests_target_user_id_created_at_idx" ON "admin_wallet_credit_requests"("target_user_id", "created_at");

CREATE UNIQUE INDEX "admin_wallet_funding_requests_external_reference_hash_key" ON "admin_wallet_funding_requests"("external_reference_hash");
CREATE UNIQUE INDEX "admin_wallet_funding_requests_idempotency_key_key" ON "admin_wallet_funding_requests"("idempotency_key");
CREATE UNIQUE INDEX "admin_wallet_funding_requests_ledger_transaction_id_key" ON "admin_wallet_funding_requests"("ledger_transaction_id");
CREATE INDEX "admin_wallet_funding_requests_status_created_at_idx" ON "admin_wallet_funding_requests"("status", "created_at");

ALTER TABLE "admin_wallet_credit_requests"
  ADD CONSTRAINT "admin_wallet_credit_requests_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "admin_wallet_credit_requests_maker_user_id_fkey" FOREIGN KEY ("maker_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "admin_wallet_credit_requests_checker_user_id_fkey" FOREIGN KEY ("checker_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "admin_wallet_credit_requests_ledger_transaction_id_fkey" FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "admin_wallet_funding_requests"
  ADD CONSTRAINT "admin_wallet_funding_requests_maker_user_id_fkey" FOREIGN KEY ("maker_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "admin_wallet_funding_requests_checker_user_id_fkey" FOREIGN KEY ("checker_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "admin_wallet_funding_requests_ledger_transaction_id_fkey" FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Provision an empty, zero-balance cash asset account. The migration creates
-- no ledger entries or funds; external receipt evidence is required before a
-- two-person funding approval can post any journal.
INSERT INTO "ledger_accounts" ("id", "user_id", "type", "currency")
VALUES ('00000000-0000-4000-8000-000000000102', NULL, 'SETTLEMENT_CASH', 'INR')
ON CONFLICT ("id") DO NOTHING;
