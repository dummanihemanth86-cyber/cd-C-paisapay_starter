ALTER TABLE "p2p_deposit_orders"
  ADD COLUMN "expires_at" TIMESTAMPTZ(3);

CREATE INDEX "p2p_deposit_orders_status_expires_at_idx"
  ON "p2p_deposit_orders"("status", "expires_at");
