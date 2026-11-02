-- Keep offer expiry comparisons consistent between application UTC and PostgreSQL NOW().
-- Existing values were written from UTC JavaScript Date values into a timestamp without timezone.
ALTER TABLE "p2p_withdrawal_offers"
  ALTER COLUMN "expires_at" TYPE TIMESTAMPTZ(3)
  USING "expires_at" AT TIME ZONE 'UTC';