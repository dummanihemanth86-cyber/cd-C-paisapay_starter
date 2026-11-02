ALTER TABLE "otp_challenges"
  ADD COLUMN "gateway_request_id" TEXT,
  ADD COLUMN "gateway_sms_id" BIGINT,
  ADD COLUMN "delivery_status" TEXT;

CREATE UNIQUE INDEX "otp_challenges_gateway_request_id_key"
  ON "otp_challenges"("gateway_request_id");
