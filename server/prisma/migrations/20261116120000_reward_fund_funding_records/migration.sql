CREATE TABLE "reward_fund_funding_records" (
    "id" UUID NOT NULL,
    "verified_by_user_id" UUID NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "source_account_label" VARCHAR(100) NOT NULL,
    "external_reference_hash" CHAR(64) NOT NULL,
    "evidence_reference" VARCHAR(160) NOT NULL,
    "evidence_sha256" CHAR(64) NOT NULL,
    "statement_date" DATE NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "idempotency_key" VARCHAR(120) NOT NULL,
    "ledger_transaction_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reward_fund_funding_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reward_fund_funding_records_external_reference_hash_key"
    ON "reward_fund_funding_records"("external_reference_hash");
CREATE UNIQUE INDEX "reward_fund_funding_records_idempotency_key_key"
    ON "reward_fund_funding_records"("idempotency_key");
CREATE UNIQUE INDEX "reward_fund_funding_records_ledger_transaction_id_key"
    ON "reward_fund_funding_records"("ledger_transaction_id");
CREATE INDEX "reward_fund_funding_records_created_at_idx"
    ON "reward_fund_funding_records"("created_at");

ALTER TABLE "reward_fund_funding_records"
    ADD CONSTRAINT "reward_fund_funding_records_verified_by_user_id_fkey"
    FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reward_fund_funding_records"
    ADD CONSTRAINT "reward_fund_funding_records_ledger_transaction_id_fkey"
    FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "reward_fund_funding_records"
    ADD CONSTRAINT "reward_fund_funding_records_amount_paise_check"
    CHECK ("amount_paise" > 0);
