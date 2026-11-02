CREATE TABLE "admin_push_devices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "admin_user_id" UUID NOT NULL,
  "expo_push_token" VARCHAR(255) NOT NULL,
  "platform" VARCHAR(16) NOT NULL,
  "revoked_at" TIMESTAMPTZ(3),
  "last_registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_push_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_push_devices_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "admin_push_devices_expo_push_token_key" ON "admin_push_devices"("expo_push_token");
CREATE INDEX "admin_push_devices_admin_user_id_revoked_at_idx" ON "admin_push_devices"("admin_user_id", "revoked_at");

CREATE TABLE "admin_push_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_key" VARCHAR(180) NOT NULL,
  "type" VARCHAR(60) NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "body" VARCHAR(240) NOT NULL,
  "claim_id" UUID NOT NULL,
  "deliveries_prepared_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_push_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_push_events_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "p2p_payment_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "admin_push_events_event_key_key" ON "admin_push_events"("event_key");
CREATE INDEX "admin_push_events_type_created_at_idx" ON "admin_push_events"("type", "created_at");

CREATE TABLE "admin_push_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "event_id" UUID NOT NULL,
  "device_id" UUID NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMPTZ(3),
  "accepted_at" TIMESTAMPTZ(3),
  "last_error" VARCHAR(500),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_push_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "admin_push_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "admin_push_events"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "admin_push_deliveries_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "admin_push_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "admin_push_deliveries_event_id_device_id_key" ON "admin_push_deliveries"("event_id", "device_id");
CREATE INDEX "admin_push_deliveries_status_next_attempt_at_idx" ON "admin_push_deliveries"("status", "next_attempt_at");
