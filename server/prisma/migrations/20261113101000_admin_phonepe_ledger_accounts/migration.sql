-- Dedicated zero-balance settlement and receipt-credit accounts for the
-- manually verified Admin PhonePe flow. This records no money by itself.
INSERT INTO "ledger_accounts" ("id", "user_id", "type", "currency")
VALUES
  ('00000000-0000-4000-8000-000000000101', NULL, 'ADMIN_ADJUSTMENT_FUND', 'INR'),
  ('00000000-0000-4000-8000-000000000102', NULL, 'SETTLEMENT_CASH', 'INR')
ON CONFLICT ("id") DO NOTHING;
