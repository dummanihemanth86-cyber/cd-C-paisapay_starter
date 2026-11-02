ALTER TABLE "p2p_deposit_orders"
  ADD COLUMN "cancellation_requested_at" TIMESTAMPTZ(3);

ALTER TABLE "p2p_payment_claims"
  ALTER COLUMN "transaction_reference" DROP NOT NULL,
  ADD COLUMN "claimed_amount_paise" BIGINT,
  ADD COLUMN "claimed_paid_at" TIMESTAMPTZ(3),
  ADD COLUMN "evidence_image" BYTEA,
  ADD COLUMN "evidence_mime_type" TEXT;

ALTER TABLE "p2p_payment_claims"
  ADD CONSTRAINT "p2p_payment_claims_claimed_amount_paise_check"
  CHECK ("claimed_amount_paise" IS NULL OR "claimed_amount_paise" > 0);
