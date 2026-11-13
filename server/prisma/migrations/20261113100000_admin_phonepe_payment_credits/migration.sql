-- Super Admin may credit only after manually confirming the exact PhonePe/UPI
-- receipt in the receiver's account. Every approval remains balanced and audited.
CREATE TABLE "admin_phonepe_credit_requests" (
  "id" UUID NOT NULL,
  "target_user_id" UUID NOT NULL,
  "maker_user_id" UUID NOT NULL,
  "amount_paise" BIGINT NOT NULL,
  "payee_vpa" VARCHAR(100) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING_PAYMENT',
  "idempotency_key" VARCHAR(100) NOT NULL,
  "payment_reference_hash" CHAR(64),
  "payment_reference_masked" VARCHAR(24),
  "decision_reason" VARCHAR(500),
  "funding_ledger_transaction_id" UUID,
  "ledger_transaction_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "decided_at" TIMESTAMPTZ(3),
  CONSTRAINT "admin_phonepe_credit_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_phonepe_credit_requests_amount_check" CHECK ("amount_paise" BETWEEN 10000 AND 1000000 AND "amount_paise" % 100 = 0),
  CONSTRAINT "admin_phonepe_credit_requests_status_check" CHECK ("status" IN ('PENDING_PAYMENT', 'COMPLETED', 'REJECTED', 'EXPIRED')),
  CONSTRAINT "admin_phonepe_credit_requests_idempotency_key_key" UNIQUE ("idempotency_key"),
  CONSTRAINT "admin_phonepe_credit_requests_payment_reference_hash_key" UNIQUE ("payment_reference_hash"),
  CONSTRAINT "admin_phonepe_credit_requests_funding_ledger_transaction_id_key" UNIQUE ("funding_ledger_transaction_id"),
  CONSTRAINT "admin_phonepe_credit_requests_ledger_transaction_id_key" UNIQUE ("ledger_transaction_id"),
  CONSTRAINT "admin_phonepe_credit_requests_target_user_id_fkey" FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "admin_phonepe_credit_requests_maker_user_id_fkey" FOREIGN KEY ("maker_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "admin_phonepe_credit_requests_funding_ledger_transaction_id_fkey" FOREIGN KEY ("funding_ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "admin_phonepe_credit_requests_ledger_transaction_id_fkey" FOREIGN KEY ("ledger_transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "admin_phonepe_credit_requests_status_created_at_idx" ON "admin_phonepe_credit_requests"("status", "created_at");
CREATE INDEX "admin_phonepe_credit_requests_target_user_id_created_at_idx" ON "admin_phonepe_credit_requests"("target_user_id", "created_at");
