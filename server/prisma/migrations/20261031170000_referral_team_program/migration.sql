ALTER TABLE "commission_entries"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'DIRECT_COMMISSION',
  ADD COLUMN "level" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "source_user_id" UUID,
  ADD COLUMN "qualifying_amount_paise" BIGINT;

CREATE INDEX "commission_entries_user_id_kind_created_at_idx"
  ON "commission_entries"("user_id", "kind", "created_at");

CREATE TABLE "referral_program_config" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "direct_rate_bps" INTEGER NOT NULL DEFAULT 40,
  "indirect_rate_bps" INTEGER NOT NULL DEFAULT 10,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_program_config_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "referral_program_config_singleton_check" CHECK ("id" = 1),
  CONSTRAINT "referral_program_config_rates_check" CHECK ("direct_rate_bps" BETWEEN 0 AND 1000 AND "indirect_rate_bps" BETWEEN 0 AND 1000)
);

INSERT INTO "referral_program_config" ("id", "direct_rate_bps", "indirect_rate_bps")
VALUES (1, 40, 10)
ON CONFLICT ("id") DO NOTHING;

CREATE TABLE "referral_milestone_rules" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "required_referrals" INTEGER NOT NULL,
  "qualifying_top_up_paise" BIGINT,
  "reward_amount_paise" BIGINT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "referral_milestone_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "referral_milestone_rules_key_key" UNIQUE ("key"),
  CONSTRAINT "referral_milestone_rules_required_referrals_check" CHECK ("required_referrals" > 0),
  CONSTRAINT "referral_milestone_rules_reward_amount_check" CHECK ("reward_amount_paise" >= 0),
  CONSTRAINT "referral_milestone_rules_qualifying_amount_check" CHECK ("qualifying_top_up_paise" IS NULL OR "qualifying_top_up_paise" > 0)
);

INSERT INTO "referral_milestone_rules" ("key", "required_referrals", "qualifying_top_up_paise", "reward_amount_paise") VALUES
  ('TIER_5', 5, 2000000, 200000),
  ('TIER_10', 10, 3000000, 500000),
  ('TIER_20', 20, NULL, 1500000)
ON CONFLICT ("key") DO NOTHING;
