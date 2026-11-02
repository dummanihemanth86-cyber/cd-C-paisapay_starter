-- Add an eight-minute unpaid UPI order expiry without deleting deposit history.
ALTER TYPE "DepositStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TABLE "deposits"
  ADD COLUMN "expires_at" TIMESTAMP(3);

UPDATE "deposits"
SET "expires_at" = "created_at" + INTERVAL '8 minutes'
WHERE "method" = 'UPI'
  AND "status" IN ('CREATED', 'PENDING_PAYMENT')
  AND "expires_at" IS NULL;

CREATE INDEX "deposits_method_status_expires_at_idx"
  ON "deposits"("method", "status", "expires_at");
