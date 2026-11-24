ALTER TABLE "p2p_withdrawal_offers"
    ADD COLUMN "funding_source" VARCHAR(16) NOT NULL DEFAULT 'CASH';

ALTER TABLE "p2p_withdrawal_offers"
    ADD CONSTRAINT "p2p_withdrawal_offers_funding_source_check"
    CHECK ("funding_source" IN ('CASH', 'REWARD'));

CREATE TABLE "reward_wallets" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "available_paise" BIGINT NOT NULL DEFAULT 0,
    "pending_paise" BIGINT NOT NULL DEFAULT 0,
    "reserved_paise" BIGINT NOT NULL DEFAULT 0,
    "total_earned_paise" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "reward_wallets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_wallets_available_nonnegative" CHECK ("available_paise" >= 0),
    CONSTRAINT "reward_wallets_pending_nonnegative" CHECK ("pending_paise" >= 0),
    CONSTRAINT "reward_wallets_reserved_nonnegative" CHECK ("reserved_paise" >= 0),
    CONSTRAINT "reward_wallets_total_earned_nonnegative" CHECK ("total_earned_paise" >= 0)
);

CREATE UNIQUE INDEX "reward_wallets_user_id_key" ON "reward_wallets"("user_id");
ALTER TABLE "reward_wallets"
    ADD CONSTRAINT "reward_wallets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "reward_ledger_entries" (
    "id" UUID NOT NULL,
    "wallet_id" UUID NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "reference_type" VARCHAR(64) NOT NULL,
    "reference_id" VARCHAR(120) NOT NULL,
    "amount_paise" BIGINT NOT NULL,
    "available_delta_paise" BIGINT NOT NULL DEFAULT 0,
    "pending_delta_paise" BIGINT NOT NULL DEFAULT 0,
    "reserved_delta_paise" BIGINT NOT NULL DEFAULT 0,
    "idempotency_key" VARCHAR(180) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reward_ledger_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reward_ledger_entries_amount_positive" CHECK ("amount_paise" > 0),
    CONSTRAINT "reward_ledger_entries_nonzero_delta" CHECK (
        "available_delta_paise" <> 0 OR "pending_delta_paise" <> 0 OR "reserved_delta_paise" <> 0
    )
);

CREATE UNIQUE INDEX "reward_ledger_entries_idempotency_key_key" ON "reward_ledger_entries"("idempotency_key");
CREATE INDEX "reward_ledger_entries_wallet_id_created_at_idx" ON "reward_ledger_entries"("wallet_id", "created_at");
CREATE INDEX "reward_ledger_entries_reference_type_reference_id_idx" ON "reward_ledger_entries"("reference_type", "reference_id");
ALTER TABLE "reward_ledger_entries"
    ADD CONSTRAINT "reward_ledger_entries_wallet_id_fkey"
    FOREIGN KEY ("wallet_id") REFERENCES "reward_wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
