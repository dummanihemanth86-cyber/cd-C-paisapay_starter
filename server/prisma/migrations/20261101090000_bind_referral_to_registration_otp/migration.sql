-- Keep optional registration attribution with the OTP challenge so the
-- referral cannot be lost if mobile state is cleared between OTP steps.
ALTER TABLE "otp_challenges"
  ADD COLUMN "referral_code" TEXT;

CREATE INDEX "otp_challenges_purpose_referral_code_idx"
  ON "otp_challenges"("purpose", "referral_code");
