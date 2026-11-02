ALTER TABLE "users"
  ADD COLUMN "login_failed_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "login_locked_until" TIMESTAMP(3);

ALTER TABLE "otp_challenges"
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'LOGIN';

CREATE INDEX "otp_challenges_phone_e164_purpose_created_at_idx"
  ON "otp_challenges"("phone_e164", "purpose", "created_at");
