-- Additive workflow for manually verified reward-pool funding. Existing
-- reward wallets, funding records, customer balances, and order history remain.
ALTER TYPE "LedgerAccountType" ADD VALUE IF NOT EXISTS 'REWARD_LIABILITY';

CREATE TABLE "reward_fund_funding_requests" (
    "id" UUID NOT NULL,
    "maker_user_id" UUID NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "recipient_vpa" VARCHAR(100) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'PENDING_PAYMENT',
    "idempotency_key" VARCHAR(120) NOT NULL,
    "payment_reference_hash" CHAR(64),
    "payment_reference_masked" VARCHAR(24),
    "statement_date" DATE,
    "evidence_reference" VARCHAR(160),
    "verified_by_user_id" UUID,
    "decision_reason" VARCHAR(500),
    "ledger_transaction_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    CONSTRAINT "reward_fund_funding_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_fund_funding_requests_amount_check" CHECK ("amount_paise" > 0),
    CONSTRAINT "reward_fund_funding_requests_status_check" CHECK ("status" IN ('PENDING_PAYMENT', 'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED'))
);

CREATE UNIQUE INDEX "reward_fund_funding_requests_idempotency_key_key"
    ON "reward_fund_funding_requests"("idempotency_key");
CREATE UNIQUE INDEX "reward_fund_funding_requests_payment_reference_hash_key"
    ON "reward_fund_funding_requests"("payment_reference_hash");
CREATE UNIQUE INDEX "reward_fund_funding_requests_ledger_transaction_id_key"
    ON "reward_fund_funding_requests"("ledger_transaction_id");
CREATE INDEX "reward_fund_funding_requests_status_created_at_idx"
    ON "reward_fund_funding_requests"("status", "created_at");
CREATE INDEX "reward_fund_funding_requests_maker_user_id_created_at_idx"
    ON "reward_fund_funding_requests"("maker_user_id", "created_at");

ALTER TABLE "reward_fund_funding_requests"
    ADD CONSTRAINT "reward_fund_funding_requests_maker_user_id_fkey"
    FOREIGN KEY ("maker_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_fund_funding_requests"
    ADD CONSTRAINT "reward_fund_funding_requests_verified_by_user_id_fkey"
    FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_fund_funding_requests"
    ADD CONSTRAINT "reward_fund_funding_requests_ledger_transaction_id_fkey"
    FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reward_fund_funding_records"
    ALTER COLUMN "evidence_sha256" DROP NOT NULL;
ALTER TABLE "reward_fund_funding_records"
    ADD COLUMN "funding_request_id" UUID;
CREATE UNIQUE INDEX "reward_fund_funding_records_funding_request_id_key"
    ON "reward_fund_funding_records"("funding_request_id");
ALTER TABLE "reward_fund_funding_records"
    ADD CONSTRAINT "reward_fund_funding_records_funding_request_id_fkey"
    FOREIGN KEY ("funding_request_id") REFERENCES "reward_fund_funding_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
