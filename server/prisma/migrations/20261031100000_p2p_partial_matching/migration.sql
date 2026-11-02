-- Allow multiple buyer orders to fulfill one seller withdrawal offer in parts.
-- Existing order rows are preserved; only the one-to-one uniqueness is removed.
DROP INDEX IF EXISTS "p2p_deposit_orders_withdrawal_offer_id_key";

CREATE INDEX "p2p_deposit_orders_withdrawal_offer_id_created_at_idx"
  ON "p2p_deposit_orders"("withdrawal_offer_id", "created_at");
