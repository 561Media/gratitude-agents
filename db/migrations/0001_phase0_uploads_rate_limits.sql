-- Phase 0: server-owned upload intents (blob_uploads) and per-user rate limit
-- counters (usage_counters). New tables only.
--
-- SCHEMA DRIFT, NOT FIXED HERE: drizzle-kit also emitted the statements below
-- because 0000 predates them. Production already has these columns (added via
-- db:push), so they were removed from this file to keep it runnable there.
-- A migrate-from-empty database will be missing them until a baseline
-- migration is written:
--   ALTER TABLE "conversations" ADD COLUMN "enriched_through" integer DEFAULT 0 NOT NULL;
--   ALTER TABLE "knowledgebase_entries" ADD COLUMN "embedding" vector(768);
--   ALTER TABLE "knowledgebase_entries" ADD COLUMN "expires_at" timestamp;
--   ALTER TABLE "knowledgebase_entries" ADD COLUMN "usage_count" integer DEFAULT 0 NOT NULL;
--   ALTER TABLE "knowledgebase_entries" ADD COLUMN "last_used_at" timestamp;
--   ALTER TABLE "resources" ADD COLUMN "blob_url" text;

CREATE TYPE "public"."blob_upload_status" AS ENUM('pending', 'uploaded', 'linked', 'rejected');--> statement-breakpoint
CREATE TABLE "blob_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"pathname" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"max_bytes" integer NOT NULL,
	"status" "blob_upload_status" DEFAULT 'pending' NOT NULL,
	"blob_url" text,
	"resource_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"user_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_counters_user_id_bucket_window_start_pk" PRIMARY KEY("user_id","bucket","window_start")
);
--> statement-breakpoint
ALTER TABLE "blob_uploads" ADD CONSTRAINT "blob_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blob_uploads" ADD CONSTRAINT "blob_uploads_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blob_uploads_user_idx" ON "blob_uploads" USING btree ("user_id","created_at");