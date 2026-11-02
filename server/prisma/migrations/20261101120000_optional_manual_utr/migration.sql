-- Transaction images can be submitted without a user-entered UTR.
-- Finance supplies and independently verifies the actual transaction reference during review.
ALTER TABLE "manual_payment_claims"
  ALTER COLUMN "transaction_reference" DROP NOT NULL;
