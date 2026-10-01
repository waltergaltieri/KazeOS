ALTER TABLE "lh_runs" ADD COLUMN "scheduled_for" timestamp with time zone;--> statement-breakpoint
UPDATE "lh_runs" SET "scheduled_for" = "created_at" WHERE "scheduled_for" IS NULL;--> statement-breakpoint
ALTER TABLE "lh_runs" ALTER COLUMN "scheduled_for" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lh_jobs" ADD COLUMN "lease_token_digest" text;--> statement-breakpoint
UPDATE "lh_jobs"
SET
	"state" = 'queued',
	"lease_owner" = NULL,
	"lease_expires_at" = NULL,
	"last_error" = 'Lease reset during runtime migration'
WHERE "state" = 'leased';--> statement-breakpoint
ALTER TABLE "lh_jobs" DROP CONSTRAINT "lh_jobs_lease_consistency";--> statement-breakpoint
ALTER TABLE "lh_jobs" ADD CONSTRAINT "lh_jobs_lease_consistency" CHECK ("lh_jobs"."state" <> 'leased' or ("lh_jobs"."lease_owner" is not null and "lh_jobs"."lease_token_digest" is not null and "lh_jobs"."lease_expires_at" is not null));--> statement-breakpoint
ALTER TABLE "lh_jobs" ADD CONSTRAINT "lh_jobs_lease_token_digest_format" CHECK ("lh_jobs"."lease_token_digest" is null or "lh_jobs"."lease_token_digest" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
DROP INDEX "lh_jobs_claimable_idx";--> statement-breakpoint
CREATE INDEX "lh_jobs_claimable_idx" ON "lh_jobs" USING btree ("state","lease_expires_at","created_at") WHERE "lh_jobs"."state" in ('queued', 'leased');--> statement-breakpoint
CREATE UNIQUE INDEX "lh_runs_active_slot_unique" ON "lh_runs" USING btree ("owner_id","campaign_id","campaign_version","scheduled_for") WHERE "lh_runs"."state" in ('planned', 'running');
