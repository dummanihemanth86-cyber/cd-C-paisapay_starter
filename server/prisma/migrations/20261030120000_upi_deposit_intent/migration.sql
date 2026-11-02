-- Add UPI intent deposits while preserving existing payment history.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'UPI';

CREATE TABLE IF NOT EXISTS "bank_accounts" (
  "id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "account_holder_name" TEXT NOT NULL,
  "bank_name" TEXT,
  "account_number_ciphertext" TEXT NOT NULL,
  "account_number_nonce" TEXT NOT NULL,
  "account_number_tag" TEXT NOT NULL,
  "account_number_hash" TEXT NOT NULL,
  "account_last4" CHAR(4) NOT NULL,
  "ifsc" VARCHAR(11) NOT NULL,
  "verification_status" TEXT NOT NULL DEFAULT 'UNVERIFIED',
  "verified_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bank_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "bank_accounts_user_id_account_number_hash_key" ON "bank_accounts"("user_id", "account_number_hash");
CREATE INDEX IF NOT EXISTS "bank_accounts_user_id_created_at_idx" ON "bank_accounts"("user_id", "created_at");
