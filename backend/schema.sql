-- PostgreSQL schema starter. Not wired to the demo API yet.
-- All monetary values use integer paise; never floating-point.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE ledger_account_type AS ENUM (
  'CUSTOMER_AVAILABLE', 'CUSTOMER_RESERVED', 'CUSTOMER_WITHDRAWAL_PENDING',
  'SETTLEMENT_CASH', 'DEPOSIT_CLEARING', 'COMMISSION_EXPENSE', 'PAYMENT_SUSPENSE'
);
CREATE TYPE order_state AS ENUM (
  'AVAILABLE', 'RESERVED', 'PAYMENT_SUBMITTED', 'PAYMENT_UNDER_REVIEW',
  'PAYMENT_VERIFIED', 'SETTLED', 'EXPIRED', 'CANCELLED', 'PAYMENT_REJECTED', 'DISPUTED', 'REFUNDED'
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ledger_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  account_type ledger_account_type NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ledger_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_by UUID REFERENCES users(id),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES ledger_transactions(id),
  account_id UUID NOT NULL REFERENCES ledger_accounts(id),
  debit_paise BIGINT NOT NULL DEFAULT 0 CHECK (debit_paise >= 0),
  credit_paise BIGINT NOT NULL DEFAULT 0 CHECK (credit_paise >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((debit_paise > 0 AND credit_paise = 0) OR (credit_paise > 0 AND debit_paise = 0))
);
CREATE INDEX ledger_entries_account_idx ON ledger_entries(account_id, created_at DESC);
CREATE TABLE deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  payment_reference TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'CREATED',
  verified_by UUID REFERENCES users(id),
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES users(id),
  buyer_id UUID REFERENCES users(id),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  state order_state NOT NULL DEFAULT 'AVAILABLE',
  expires_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);
CREATE INDEX orders_available_idx ON orders(state, created_at) WHERE state = 'AVAILABLE';
CREATE TABLE order_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL UNIQUE REFERENCES orders(id),
  account_id UUID NOT NULL REFERENCES ledger_accounts(id),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ
);
CREATE TABLE commission_awards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  deposit_id UUID NOT NULL UNIQUE REFERENCES deposits(id),
  rate_bps INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  amount_paise BIGINT NOT NULL CHECK (amount_paise >= 0),
  funding_source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING_FUNDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE payment_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  deposit_id UUID REFERENCES deposits(id),
  submitted_by UUID NOT NULL REFERENCES users(id),
  reference TEXT,
  evidence_uri TEXT,
  review_status TEXT NOT NULL DEFAULT 'PENDING',
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (order_id IS NOT NULL OR deposit_id IS NOT NULL)
);
CREATE TABLE withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  destination_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'REQUESTED',
  payout_reference TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Additional entities used by the application. Sensitive credentials and OTP codes are
-- intentionally absent. Store provider references/tokens only after an approved OAuth flow.
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  refresh_token_hash TEXT NOT NULL UNIQUE,
  device_label TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_active_idx ON sessions(user_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE wallet_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK (provider IN ('MOBIKWIK','PAYTM','PHONEPE','NAVI')),
  account_reference TEXT,
  connection_status TEXT NOT NULL DEFAULT 'UNAVAILABLE',
  buy_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sell_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, provider)
);

CREATE TABLE payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_reference TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  deposit_id UUID REFERENCES deposits(id),
  order_id UUID REFERENCES orders(id),
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  status TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  provider_payload_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_reference),
  CHECK (deposit_id IS NOT NULL OR order_id IS NOT NULL)
);

CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES users(id),
  referred_user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  referral_code TEXT NOT NULL,
  eligibility_status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  reward_type TEXT NOT NULL,
  amount_paise BIGINT NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  currency CHAR(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  eligibility_rule TEXT NOT NULL,
  funding_reference TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  ledger_transaction_id UUID REFERENCES ledger_transactions(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE support_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id),
  author_user_id UUID REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE admin_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('SUPPORT','OPERATIONS','FINANCE','ADMIN','SUPER_ADMIN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE idempotency_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(scope, idempotency_key)
);

ALTER TABLE deposits ADD COLUMN IF NOT EXISTS ledger_transaction_id UUID REFERENCES ledger_transactions(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ledger_transaction_id UUID REFERENCES ledger_transactions(id);
ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS ledger_transaction_id UUID REFERENCES ledger_transactions(id);

CREATE TABLE vip_levels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level_number SMALLINT NOT NULL UNIQUE CHECK (level_number BETWEEN 1 AND 10),
  display_name TEXT NOT NULL,
  eligibility_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  benefits JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_vip_status (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  vip_level_id UUID REFERENCES vip_levels(id),
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE task_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  eligibility_rules JSONB NOT NULL DEFAULT '{}'::jsonb,
  reward_paise BIGINT NOT NULL DEFAULT 0 CHECK (reward_paise >= 0),
  funded BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_task_progress (
  user_id UUID NOT NULL REFERENCES users(id),
  task_id UUID NOT NULL REFERENCES task_definitions(id),
  progress JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  completed_at TIMESTAMPTZ,
  reward_id UUID REFERENCES rewards(id),
  PRIMARY KEY (user_id, task_id)
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_unread_idx ON notifications(user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE payment_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID REFERENCES orders(id),
  deposit_id UUID REFERENCES deposits(id),
  opened_by UUID NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'OPEN',
  reason TEXT NOT NULL,
  resolution TEXT,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (order_id IS NOT NULL OR deposit_id IS NOT NULL)
);

CREATE TABLE app_releases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_name TEXT NOT NULL UNIQUE,
  version_code INTEGER NOT NULL UNIQUE CHECK (version_code > 0),
  release_notes TEXT NOT NULL,
  apk_https_url TEXT,
  apk_sha256 TEXT,
  minimum_supported_version_code INTEGER NOT NULL DEFAULT 1,
  published_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE provider_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
  processing_status TEXT NOT NULL DEFAULT 'RECEIVED',
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  UNIQUE(provider, provider_event_id)
);

-- Append-only policy is enforced by production DB roles: application roles must not
-- UPDATE or DELETE ledger_transactions/ledger_entries. Post transactions through a
-- server-side function that checks equal debit/credit totals within one DB transaction.

-- Production implementation must enforce balanced debit/credit totals per transaction
-- with a deferred constraint trigger or a posting function, plus DB transactions/locks.
-- Never let the client write ledger entries directly.
