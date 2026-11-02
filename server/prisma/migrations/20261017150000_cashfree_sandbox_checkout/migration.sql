ALTER TYPE "PaymentMethod" ADD VALUE 'CASHFREE';

ALTER TABLE "deposits"
ADD COLUMN "payment_session_id" TEXT;


