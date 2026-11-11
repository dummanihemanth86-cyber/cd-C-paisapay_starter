-- Records seller-side UPI receipt acknowledgement for an existing matched order.
-- This never settles the order; Finance still independently verifies the receipt.
CREATE TABLE "p2p_seller_payment_confirmations" (
  "id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "transaction_reference" VARCHAR(120) NOT NULL,
  "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "p2p_seller_payment_confirmations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "p2p_seller_payment_confirmations_order_id_key" UNIQUE ("order_id"),
  CONSTRAINT "p2p_seller_payment_confirmations_transaction_reference_key" UNIQUE ("transaction_reference"),
  CONSTRAINT "p2p_seller_payment_confirmations_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "p2p_deposit_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
