ALTER TABLE "users"
  ADD COLUMN "public_id" VARCHAR(10);

CREATE UNIQUE INDEX "users_public_id_key" ON "users"("public_id");
