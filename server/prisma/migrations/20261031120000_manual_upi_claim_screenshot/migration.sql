ALTER TABLE "manual_payment_claims"
  ADD COLUMN "evidence_image" BYTEA,
  ADD COLUMN "evidence_mime_type" TEXT;
