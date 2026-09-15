-- Clerk identity mapping (phase0-clerk-auth, 2026-09-15).
-- Idempotent on purpose: production was evolved with `drizzle-kit push`, so the
-- 0000 snapshot is stale and this file is applied by hand (see docs/auth.md).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "clerk_user_id" text;
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_clerk_user_id_unique" UNIQUE ("clerk_user_id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN duplicate_table THEN NULL;
END $$;
