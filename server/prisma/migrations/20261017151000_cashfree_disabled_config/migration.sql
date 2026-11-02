INSERT INTO "payment_method_configurations" ("id", "method", "buy_enabled", "sell_enabled", "provider_approved", "enabled", "updated_at")
VALUES ('c7f091c2-15f1-49a4-9a55-c114c5c02328', 'CASHFREE', false, false, false, false, CURRENT_TIMESTAMP)
ON CONFLICT ("method") DO NOTHING;
