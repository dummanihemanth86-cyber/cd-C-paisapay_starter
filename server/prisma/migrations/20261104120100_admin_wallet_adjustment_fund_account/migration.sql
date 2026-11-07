-- Empty treasury account used only as the balancing source/sink for
-- explicitly authorized wallet adjustments. This does not fund or credit it.
INSERT INTO ledger_accounts (id, user_id, type, currency)
VALUES ('00000000-0000-4000-8000-000000000101', NULL, 'ADMIN_ADJUSTMENT_FUND', 'INR')
ON CONFLICT (id) DO NOTHING;
