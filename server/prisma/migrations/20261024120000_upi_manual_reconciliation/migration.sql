-- Additive changes only: preserve existing user, payment, and ledger records.
ALTER TABLE "users"
  ADD COLUMN "upi_id" TEXT,
  ADD COLUMN "upi_id_verified_at" TIMESTAMPTZ;

CREATE TABLE "manual_payment_claims" (
  "id" UUID NOT NULL,
  "deposit_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "transaction_reference" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  "reviewed_by_user_id" UUID,
  "review_reason" TEXT,
  "evidence_reference" TEXT,
  "verified_amount_paise" BIGINT,
  "verified_currency" CHAR(3),
  "receiver_confirmed" BOOLEAN NOT NULL DEFAULT FALSE,
  "reviewed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "manual_payment_claims_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "manual_payment_claims_deposit_id_key" ON "manual_payment_claims"("deposit_id");
CREATE UNIQUE INDEX "manual_payment_claims_transaction_reference_key" ON "manual_payment_claims"("transaction_reference");
CREATE INDEX "manual_payment_claims_status_created_at_idx" ON "manual_payment_claims"("status", "created_at");
CREATE INDEX "manual_payment_claims_user_id_created_at_idx" ON "manual_payment_claims"("user_id", "created_at");

ALTER TABLE "manual_payment_claims"
  ADD CONSTRAINT "manual_payment_claims_deposit_id_fkey" FOREIGN KEY ("deposit_id") REFERENCES "deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "manual_payment_claims_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "manual_payment_claims_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Fixed system clearing account used only as the other side of a manually
-- verified external receipt. It starts at zero and creates no money by itself.
INSERT INTO "ledger_accounts" ("id", "user_id", "type", "currency", "created_at")
VALUES ('00000000-0000-4000-8000-000000000097', NULL, 'DEPOSIT_CLEARING', 'INR', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
