CREATE TYPE "public"."lh_job_kind" AS ENUM('discover', 'resolve_identity', 'research', 'audit_website', 'qualify', 'enrich_contact', 'prepare_message', 'validate_message');--> statement-breakpoint
CREATE TYPE "public"."lh_job_state" AS ENUM('queued', 'leased', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lh_message_state" AS ENUM('draft', 'valid', 'invalid', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."lh_outbox_state" AS ENUM('queued', 'leased', 'provider_accepted', 'failed', 'unknown', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lh_run_state" AS ENUM('planned', 'running', 'completed', 'partial', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "lh_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"enrollment_id" uuid,
	"lead_id" uuid,
	"kind" "lh_job_kind" NOT NULL,
	"state" "lh_job_state" DEFAULT 'queued' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lh_jobs_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "lh_jobs_owner_idempotency_key_unique" UNIQUE("owner_id","idempotency_key"),
	CONSTRAINT "lh_jobs_attempt_count_non_negative" CHECK ("lh_jobs"."attempt_count" >= 0),
	CONSTRAINT "lh_jobs_idempotency_key_not_blank" CHECK (btrim("lh_jobs"."idempotency_key") <> ''),
	CONSTRAINT "lh_jobs_lease_consistency" CHECK ("lh_jobs"."state" <> 'leased' or ("lh_jobs"."lease_owner" is not null and "lh_jobs"."lease_expires_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "lh_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lh_message_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"campaign_version" integer NOT NULL,
	"brief" jsonb NOT NULL,
	"evidence_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lh_message_briefs_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "lh_message_briefs_owner_id_enrollment_unique" UNIQUE("owner_id","id","enrollment_id"),
	CONSTRAINT "lh_message_briefs_enrollment_version_unique" UNIQUE("owner_id","enrollment_id","campaign_version"),
	CONSTRAINT "lh_message_briefs_campaign_version_positive" CHECK ("lh_message_briefs"."campaign_version" > 0),
	CONSTRAINT "lh_message_briefs_brief_object" CHECK (jsonb_typeof("lh_message_briefs"."brief") = 'object')
);
--> statement-breakpoint
ALTER TABLE "lh_message_briefs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lh_message_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"brief_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"state" "lh_message_state" DEFAULT 'draft' NOT NULL,
	"validation_result" jsonb,
	"model_metadata" jsonb,
	"supersedes_message_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lh_message_versions_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "lh_message_versions_owner_id_enrollment_unique" UNIQUE("owner_id","id","enrollment_id"),
	CONSTRAINT "lh_message_versions_subject_not_blank" CHECK (btrim("lh_message_versions"."subject") <> ''),
	CONSTRAINT "lh_message_versions_body_not_blank" CHECK (btrim("lh_message_versions"."body") <> ''),
	CONSTRAINT "lh_message_versions_validation_consistency" CHECK ("lh_message_versions"."state" not in ('valid', 'invalid') or "lh_message_versions"."validation_result" is not null),
	CONSTRAINT "lh_message_versions_not_self_superseding" CHECK ("lh_message_versions"."supersedes_message_version_id" is null or "lh_message_versions"."supersedes_message_version_id" <> "lh_message_versions"."id")
);
--> statement-breakpoint
ALTER TABLE "lh_message_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lh_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"message_version_id" uuid NOT NULL,
	"recipient_email" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"logical_step" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" "lh_outbox_state" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"provider_message_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lh_outbox_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "lh_outbox_owner_idempotency_key_unique" UNIQUE("owner_id","idempotency_key"),
	CONSTRAINT "lh_outbox_recipient_email_not_blank" CHECK (btrim("lh_outbox"."recipient_email") <> ''),
	CONSTRAINT "lh_outbox_subject_not_blank" CHECK (btrim("lh_outbox"."subject") <> ''),
	CONSTRAINT "lh_outbox_body_not_blank" CHECK (btrim("lh_outbox"."body") <> ''),
	CONSTRAINT "lh_outbox_logical_step_non_negative" CHECK ("lh_outbox"."logical_step" >= 0),
	CONSTRAINT "lh_outbox_attempt_count_non_negative" CHECK ("lh_outbox"."attempt_count" >= 0),
	CONSTRAINT "lh_outbox_idempotency_key_not_blank" CHECK (btrim("lh_outbox"."idempotency_key") <> ''),
	CONSTRAINT "lh_outbox_lease_consistency" CHECK ("lh_outbox"."state" <> 'leased' or ("lh_outbox"."attempt_count" > 0 and "lh_outbox"."lease_owner" is not null and "lh_outbox"."lease_expires_at" is not null)),
	CONSTRAINT "lh_outbox_cancelled_consistency" CHECK ("lh_outbox"."state" <> 'cancelled' or ("lh_outbox"."attempt_count" = 0 and "lh_outbox"."lease_owner" is null and "lh_outbox"."lease_expires_at" is null and "lh_outbox"."provider_message_id" is null)),
	CONSTRAINT "lh_outbox_queued_consistency" CHECK ("lh_outbox"."state" <> 'queued' or ("lh_outbox"."lease_owner" is null and "lh_outbox"."lease_expires_at" is null and "lh_outbox"."provider_message_id" is null))
);
--> statement-breakpoint
ALTER TABLE "lh_outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lh_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"campaign_version" integer NOT NULL,
	"plan" jsonb NOT NULL,
	"cursor" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" "lh_run_state" DEFAULT 'planned' NOT NULL,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lh_runs_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "lh_runs_campaign_version_positive" CHECK ("lh_runs"."campaign_version" > 0),
	CONSTRAINT "lh_runs_plan_object" CHECK (jsonb_typeof("lh_runs"."plan") = 'object'),
	CONSTRAINT "lh_runs_cursor_object" CHECK (jsonb_typeof("lh_runs"."cursor") = 'object'),
	CONSTRAINT "lh_runs_counts_object" CHECK (jsonb_typeof("lh_runs"."counts") = 'object'),
	CONSTRAINT "lh_runs_finished_after_started" CHECK ("lh_runs"."finished_at" is null or "lh_runs"."started_at" is null or "lh_runs"."finished_at" >= "lh_runs"."started_at")
);
--> statement-breakpoint
ALTER TABLE "lh_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lh_source_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_identity" text NOT NULL,
	"query" text NOT NULL,
	"raw_record" jsonb NOT NULL,
	"canonical_url" text,
	"resolution_state" text DEFAULT 'pending' NOT NULL,
	"lead_id" uuid,
	"discovered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lh_source_candidates_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "lh_source_candidates_source_identity_unique" UNIQUE("owner_id","run_id","source_type","source_identity"),
	CONSTRAINT "lh_source_candidates_source_type_not_blank" CHECK (btrim("lh_source_candidates"."source_type") <> ''),
	CONSTRAINT "lh_source_candidates_source_identity_not_blank" CHECK (btrim("lh_source_candidates"."source_identity") <> ''),
	CONSTRAINT "lh_source_candidates_query_not_blank" CHECK (btrim("lh_source_candidates"."query") <> ''),
	CONSTRAINT "lh_source_candidates_resolution_state_valid" CHECK ("lh_source_candidates"."resolution_state" in ('pending', 'resolved', 'duplicate', 'needs_review', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "lh_source_candidates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lh_website_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"gate_result" text NOT NULL,
	"checks" jsonb NOT NULL,
	"summary" text NOT NULL,
	"confidence" smallint NOT NULL,
	"evidence_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lh_website_audits_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "lh_website_audits_run_enrollment_unique" UNIQUE("owner_id","run_id","enrollment_id"),
	CONSTRAINT "lh_website_audits_gate_result_valid" CHECK ("lh_website_audits"."gate_result" in ('NO_WEBSITE', 'BAD_WEBSITE', 'GOOD_ENOUGH_WEBSITE', 'UNVERIFIED')),
	CONSTRAINT "lh_website_audits_summary_not_blank" CHECK (btrim("lh_website_audits"."summary") <> ''),
	CONSTRAINT "lh_website_audits_confidence_range" CHECK ("lh_website_audits"."confidence" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "lh_website_audits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lh_contacts" ADD COLUMN "email_confidence" smallint;--> statement-breakpoint
ALTER TABLE "lh_contacts" ADD COLUMN "source_type" text;--> statement-breakpoint
ALTER TABLE "lh_contacts" ADD COLUMN "is_primary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lh_contacts" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lh_enrollments" ADD COLUMN "qualification_detail" jsonb;--> statement-breakpoint
ALTER TABLE "lh_enrollments" ADD COLUMN "research_summary" jsonb;--> statement-breakpoint
ALTER TABLE "lh_enrollments" ADD COLUMN "message_version_id" uuid;--> statement-breakpoint
ALTER TABLE "lh_evidence" ADD COLUMN "run_id" uuid;--> statement-breakpoint
ALTER TABLE "lh_evidence" ADD COLUMN "campaign_id" uuid;--> statement-breakpoint
ALTER TABLE "lh_evidence" ADD COLUMN "extract" text;--> statement-breakpoint
ALTER TABLE "lh_evidence" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "lh_jobs" ADD CONSTRAINT "lh_jobs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_jobs" ADD CONSTRAINT "lh_jobs_owner_run_runs_owner_id_id_fk" FOREIGN KEY ("owner_id","run_id") REFERENCES "public"."lh_runs"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_jobs" ADD CONSTRAINT "lh_jobs_owner_enrollment_enrollments_owner_id_id_fk" FOREIGN KEY ("owner_id","enrollment_id") REFERENCES "public"."lh_enrollments"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_jobs" ADD CONSTRAINT "lh_jobs_owner_lead_leads_owner_id_id_fk" FOREIGN KEY ("owner_id","lead_id") REFERENCES "public"."lh_leads"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_message_briefs" ADD CONSTRAINT "lh_message_briefs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_message_briefs" ADD CONSTRAINT "lh_message_briefs_owner_enrollment_enrollments_owner_id_id_fk" FOREIGN KEY ("owner_id","enrollment_id") REFERENCES "public"."lh_enrollments"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_message_briefs" ADD CONSTRAINT "lh_message_briefs_owner_contact_contacts_owner_id_id_fk" FOREIGN KEY ("owner_id","contact_id") REFERENCES "public"."lh_contacts"("owner_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_message_briefs" ADD CONSTRAINT "lh_message_briefs_owner_campaign_version_campaign_versions_owner_campaign_version_fk" FOREIGN KEY ("owner_id","campaign_id","campaign_version") REFERENCES "public"."lh_campaign_versions"("owner_id","campaign_id","version") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_message_versions" ADD CONSTRAINT "lh_message_versions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_message_versions" ADD CONSTRAINT "lh_message_versions_owner_brief_message_briefs_owner_id_id_fk" FOREIGN KEY ("owner_id","brief_id","enrollment_id") REFERENCES "public"."lh_message_briefs"("owner_id","id","enrollment_id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_message_versions" ADD CONSTRAINT "lh_message_versions_owner_enrollment_enrollments_owner_id_id_fk" FOREIGN KEY ("owner_id","enrollment_id") REFERENCES "public"."lh_enrollments"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_message_versions" ADD CONSTRAINT "lh_message_versions_owner_supersedes_message_versions_owner_id_id_enrollment_id_fk" FOREIGN KEY ("owner_id","supersedes_message_version_id","enrollment_id") REFERENCES "public"."lh_message_versions"("owner_id","id","enrollment_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_outbox" ADD CONSTRAINT "lh_outbox_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_outbox" ADD CONSTRAINT "lh_outbox_owner_enrollment_enrollments_owner_id_id_fk" FOREIGN KEY ("owner_id","enrollment_id") REFERENCES "public"."lh_enrollments"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_outbox" ADD CONSTRAINT "lh_outbox_owner_message_version_message_versions_owner_id_id_fk" FOREIGN KEY ("owner_id","message_version_id","enrollment_id") REFERENCES "public"."lh_message_versions"("owner_id","id","enrollment_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_runs" ADD CONSTRAINT "lh_runs_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_runs" ADD CONSTRAINT "lh_runs_owner_campaign_version_campaign_versions_owner_campaign_version_fk" FOREIGN KEY ("owner_id","campaign_id","campaign_version") REFERENCES "public"."lh_campaign_versions"("owner_id","campaign_id","version") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_source_candidates" ADD CONSTRAINT "lh_source_candidates_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_source_candidates" ADD CONSTRAINT "lh_source_candidates_owner_run_runs_owner_id_id_fk" FOREIGN KEY ("owner_id","run_id") REFERENCES "public"."lh_runs"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_source_candidates" ADD CONSTRAINT "lh_source_candidates_owner_lead_leads_owner_id_id_fk" FOREIGN KEY ("owner_id","lead_id") REFERENCES "public"."lh_leads"("owner_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_website_audits" ADD CONSTRAINT "lh_website_audits_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_website_audits" ADD CONSTRAINT "lh_website_audits_owner_run_runs_owner_id_id_fk" FOREIGN KEY ("owner_id","run_id") REFERENCES "public"."lh_runs"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_website_audits" ADD CONSTRAINT "lh_website_audits_owner_enrollment_enrollments_owner_id_id_fk" FOREIGN KEY ("owner_id","enrollment_id") REFERENCES "public"."lh_enrollments"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_website_audits" ADD CONSTRAINT "lh_website_audits_owner_lead_leads_owner_id_id_fk" FOREIGN KEY ("owner_id","lead_id") REFERENCES "public"."lh_leads"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "lh_jobs_owner_run_idx" ON "lh_jobs" USING btree ("owner_id","run_id");--> statement-breakpoint
CREATE INDEX "lh_jobs_owner_enrollment_idx" ON "lh_jobs" USING btree ("owner_id","enrollment_id");--> statement-breakpoint
CREATE INDEX "lh_jobs_owner_lead_idx" ON "lh_jobs" USING btree ("owner_id","lead_id");--> statement-breakpoint
CREATE INDEX "lh_jobs_claimable_idx" ON "lh_jobs" USING btree ("owner_id","state","lease_expires_at","created_at") WHERE "lh_jobs"."state" in ('queued', 'leased');--> statement-breakpoint
CREATE INDEX "lh_message_briefs_owner_enrollment_idx" ON "lh_message_briefs" USING btree ("owner_id","enrollment_id");--> statement-breakpoint
CREATE INDEX "lh_message_briefs_owner_contact_idx" ON "lh_message_briefs" USING btree ("owner_id","contact_id");--> statement-breakpoint
CREATE INDEX "lh_message_briefs_owner_campaign_version_idx" ON "lh_message_briefs" USING btree ("owner_id","campaign_id","campaign_version");--> statement-breakpoint
CREATE INDEX "lh_message_versions_owner_brief_created_idx" ON "lh_message_versions" USING btree ("owner_id","brief_id","created_at");--> statement-breakpoint
CREATE INDEX "lh_message_versions_owner_enrollment_idx" ON "lh_message_versions" USING btree ("owner_id","enrollment_id");--> statement-breakpoint
CREATE INDEX "lh_message_versions_owner_supersedes_idx" ON "lh_message_versions" USING btree ("owner_id","supersedes_message_version_id","enrollment_id") WHERE "lh_message_versions"."supersedes_message_version_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "lh_outbox_active_enrollment_logical_step_unique" ON "lh_outbox" USING btree ("owner_id","enrollment_id","logical_step") WHERE "lh_outbox"."state" <> 'cancelled' or "lh_outbox"."lease_owner" is not null or "lh_outbox"."lease_expires_at" is not null;--> statement-breakpoint
CREATE INDEX "lh_outbox_owner_enrollment_idx" ON "lh_outbox" USING btree ("owner_id","enrollment_id");--> statement-breakpoint
CREATE INDEX "lh_outbox_owner_message_version_idx" ON "lh_outbox" USING btree ("owner_id","message_version_id");--> statement-breakpoint
CREATE INDEX "lh_outbox_due_idx" ON "lh_outbox" USING btree ("owner_id","due_at") WHERE "lh_outbox"."state" = 'queued';--> statement-breakpoint
CREATE INDEX "lh_runs_owner_campaign_created_idx" ON "lh_runs" USING btree ("owner_id","campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "lh_runs_owner_state_idx" ON "lh_runs" USING btree ("owner_id","state");--> statement-breakpoint
CREATE INDEX "lh_source_candidates_owner_run_resolution_idx" ON "lh_source_candidates" USING btree ("owner_id","run_id","resolution_state");--> statement-breakpoint
CREATE INDEX "lh_source_candidates_owner_lead_idx" ON "lh_source_candidates" USING btree ("owner_id","lead_id");--> statement-breakpoint
CREATE INDEX "lh_website_audits_owner_enrollment_idx" ON "lh_website_audits" USING btree ("owner_id","enrollment_id");--> statement-breakpoint
CREATE INDEX "lh_website_audits_owner_lead_idx" ON "lh_website_audits" USING btree ("owner_id","lead_id");--> statement-breakpoint
ALTER TABLE "lh_enrollments" ADD CONSTRAINT "lh_enrollments_owner_message_version_message_versions_owner_id_id_enrollment_id_fk" FOREIGN KEY ("owner_id","message_version_id","id") REFERENCES "public"."lh_message_versions"("owner_id","id","enrollment_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_evidence" ADD CONSTRAINT "lh_evidence_owner_run_runs_owner_id_id_fk" FOREIGN KEY ("owner_id","run_id") REFERENCES "public"."lh_runs"("owner_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_evidence" ADD CONSTRAINT "lh_evidence_owner_campaign_campaigns_owner_id_id_fk" FOREIGN KEY ("owner_id","campaign_id") REFERENCES "public"."lh_campaigns"("owner_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "lh_contacts_one_primary_per_lead_unique" ON "lh_contacts" USING btree ("owner_id","lead_id") WHERE "lh_contacts"."is_primary" = true;--> statement-breakpoint
CREATE INDEX "lh_enrollments_owner_message_version_idx" ON "lh_enrollments" USING btree ("owner_id","message_version_id","id") WHERE "lh_enrollments"."message_version_id" is not null;--> statement-breakpoint
CREATE INDEX "lh_evidence_owner_run_idx" ON "lh_evidence" USING btree ("owner_id","run_id");--> statement-breakpoint
CREATE INDEX "lh_evidence_owner_campaign_idx" ON "lh_evidence" USING btree ("owner_id","campaign_id");--> statement-breakpoint
ALTER TABLE "lh_contacts" ADD CONSTRAINT "lh_contacts_email_confidence_range" CHECK ("lh_contacts"."email_confidence" is null or "lh_contacts"."email_confidence" between 0 and 100);--> statement-breakpoint
ALTER TABLE "lh_evidence" ADD CONSTRAINT "lh_evidence_content_hash_not_blank" CHECK ("lh_evidence"."content_hash" is null or btrim("lh_evidence"."content_hash") <> '');--> statement-breakpoint
CREATE POLICY "lh_jobs_authenticated_select" ON "lh_jobs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "lh_jobs"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_jobs_backend_insert" ON "lh_jobs" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "lh_jobs"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_jobs_backend_update" ON "lh_jobs" AS PERMISSIVE FOR UPDATE TO "kazeos_backend" USING ((select auth.uid()) = "lh_jobs"."owner_id") WITH CHECK ((select auth.uid()) = "lh_jobs"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_message_briefs_authenticated_select" ON "lh_message_briefs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "lh_message_briefs"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_message_briefs_backend_insert" ON "lh_message_briefs" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "lh_message_briefs"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_message_versions_authenticated_select" ON "lh_message_versions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "lh_message_versions"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_message_versions_backend_insert" ON "lh_message_versions" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "lh_message_versions"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_message_versions_backend_update" ON "lh_message_versions" AS PERMISSIVE FOR UPDATE TO "kazeos_backend" USING ((select auth.uid()) = "lh_message_versions"."owner_id") WITH CHECK ((select auth.uid()) = "lh_message_versions"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_outbox_authenticated_select" ON "lh_outbox" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "lh_outbox"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_outbox_backend_insert" ON "lh_outbox" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "lh_outbox"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_outbox_backend_update" ON "lh_outbox" AS PERMISSIVE FOR UPDATE TO "kazeos_backend" USING ((select auth.uid()) = "lh_outbox"."owner_id") WITH CHECK ((select auth.uid()) = "lh_outbox"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_runs_authenticated_select" ON "lh_runs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "lh_runs"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_runs_backend_insert" ON "lh_runs" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "lh_runs"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_runs_backend_update" ON "lh_runs" AS PERMISSIVE FOR UPDATE TO "kazeos_backend" USING ((select auth.uid()) = "lh_runs"."owner_id") WITH CHECK ((select auth.uid()) = "lh_runs"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_source_candidates_authenticated_select" ON "lh_source_candidates" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "lh_source_candidates"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_source_candidates_backend_insert" ON "lh_source_candidates" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "lh_source_candidates"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_source_candidates_backend_update" ON "lh_source_candidates" AS PERMISSIVE FOR UPDATE TO "kazeos_backend" USING ((select auth.uid()) = "lh_source_candidates"."owner_id") WITH CHECK ((select auth.uid()) = "lh_source_candidates"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_website_audits_authenticated_select" ON "lh_website_audits" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "lh_website_audits"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_website_audits_backend_insert" ON "lh_website_audits" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "lh_website_audits"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_website_audits_backend_update" ON "lh_website_audits" AS PERMISSIVE FOR UPDATE TO "kazeos_backend" USING ((select auth.uid()) = "lh_website_audits"."owner_id") WITH CHECK ((select auth.uid()) = "lh_website_audits"."owner_id");--> statement-breakpoint
REVOKE ALL ON TABLE public.lh_runs, public.lh_jobs, public.lh_source_candidates, public.lh_website_audits, public.lh_message_briefs, public.lh_message_versions, public.lh_outbox FROM public, anon, authenticated;
--> statement-breakpoint
REVOKE UPDATE ON TABLE public.lh_message_briefs FROM kazeos_backend, service_role;
--> statement-breakpoint
GRANT SELECT ON TABLE public.lh_runs, public.lh_jobs, public.lh_source_candidates, public.lh_website_audits, public.lh_message_briefs, public.lh_message_versions, public.lh_outbox TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.lh_runs, public.lh_jobs, public.lh_source_candidates, public.lh_website_audits, public.lh_message_versions, public.lh_outbox TO kazeos_backend;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.lh_message_briefs TO kazeos_backend;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.validate_lh_message_brief_coherence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM 1
  FROM public.lh_enrollments AS enrollment
  JOIN public.lh_contacts AS contact
    ON contact.owner_id = NEW.owner_id
   AND contact.id = NEW.contact_id
   AND contact.lead_id = enrollment.lead_id
  WHERE enrollment.owner_id = NEW.owner_id
    AND enrollment.id = NEW.enrollment_id
    AND enrollment.campaign_id = NEW.campaign_id
    AND enrollment.campaign_version = NEW.campaign_version
  FOR SHARE OF enrollment, contact;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'LeadHunter message brief does not match its enrollment contact and campaign version'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.guard_lh_message_version_content()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.brief_id IS DISTINCT FROM OLD.brief_id
     OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
     OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.model_metadata IS DISTINCT FROM OLD.model_metadata
     OR NEW.supersedes_message_version_id IS DISTINCT FROM OLD.supersedes_message_version_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'LeadHunter message version content is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.state <> 'draft'
     AND NEW.validation_result IS DISTINCT FROM OLD.validation_result THEN
    RAISE EXCEPTION 'LeadHunter message validation history is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state
     AND NOT (
       (OLD.state = 'draft'
        AND NEW.state IN ('valid', 'invalid')
        AND NEW.validation_result IS NOT NULL)
       OR (OLD.state = 'valid' AND NEW.state = 'superseded')
     ) THEN
    RAISE EXCEPTION 'Invalid LeadHunter message version state transition: % -> %', OLD.state, NEW.state
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.guard_lh_outbox_command()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
     OR NEW.message_version_id IS DISTINCT FROM OLD.message_version_id
     OR NEW.recipient_email IS DISTINCT FROM OLD.recipient_email
     OR NEW.subject IS DISTINCT FROM OLD.subject
     OR NEW.body IS DISTINCT FROM OLD.body
     OR NEW.due_at IS DISTINCT FROM OLD.due_at
     OR NEW.logical_step IS DISTINCT FROM OLD.logical_step
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'LeadHunter outbox command is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.attempt_count < OLD.attempt_count THEN
    RAISE EXCEPTION 'LeadHunter outbox attempt count cannot decrease'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.provider_message_id IS NOT NULL
     AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id THEN
    RAISE EXCEPTION 'LeadHunter outbox provider identity is immutable once assigned'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.state = 'cancelled'
     AND (NEW.attempt_count <> 0
          OR NEW.lease_owner IS NOT NULL
          OR NEW.lease_expires_at IS NOT NULL
          OR NEW.provider_message_id IS NOT NULL) THEN
    RAISE EXCEPTION 'A cancelled LeadHunter command must remain unleased and unsent'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF OLD.state IN ('provider_accepted', 'cancelled') THEN
      RAISE EXCEPTION 'LeadHunter outbox state % is terminal', OLD.state
        USING ERRCODE = '23514';
    ELSIF NEW.state = 'cancelled' THEN
      IF OLD.state <> 'queued'
         OR OLD.attempt_count <> 0
         OR NEW.attempt_count <> 0
         OR OLD.lease_owner IS NOT NULL
         OR OLD.lease_expires_at IS NOT NULL
         OR OLD.provider_message_id IS NOT NULL
         OR NEW.lease_owner IS NOT NULL
         OR NEW.lease_expires_at IS NOT NULL
         OR NEW.provider_message_id IS NOT NULL THEN
        RAISE EXCEPTION 'Only an unleased and unsent queued LeadHunter command may be cancelled'
          USING ERRCODE = '23514';
      END IF;
    ELSIF NOT (
      (OLD.state = 'queued' AND NEW.state = 'leased')
      OR (OLD.state = 'leased'
          AND NEW.state IN ('queued', 'provider_accepted', 'failed', 'unknown'))
      OR (OLD.state = 'failed' AND NEW.state = 'queued')
      OR (OLD.state = 'unknown' AND NEW.state IN ('provider_accepted', 'failed'))
    ) THEN
      RAISE EXCEPTION 'Invalid LeadHunter outbox state transition: % -> %', OLD.state, NEW.state
        USING ERRCODE = '23514';
    END IF;

    IF NEW.state = 'leased' AND NEW.attempt_count <= OLD.attempt_count THEN
      RAISE EXCEPTION 'Leasing a LeadHunter command must increment its attempt count'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.state = 'queued'
       AND (NEW.lease_owner IS NOT NULL
            OR NEW.lease_expires_at IS NOT NULL
            OR NEW.provider_message_id IS NOT NULL) THEN
      RAISE EXCEPTION 'A queued LeadHunter command must remain unleased and unsent'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.validate_lh_message_brief_coherence() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guard_lh_message_version_content() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION private.guard_lh_outbox_command() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER lh_message_briefs_validate_coherence BEFORE INSERT ON public.lh_message_briefs FOR EACH ROW EXECUTE FUNCTION private.validate_lh_message_brief_coherence();
--> statement-breakpoint
CREATE TRIGGER lh_message_versions_guard_content BEFORE UPDATE ON public.lh_message_versions FOR EACH ROW EXECUTE FUNCTION private.guard_lh_message_version_content();
--> statement-breakpoint
CREATE TRIGGER lh_outbox_guard_command BEFORE UPDATE ON public.lh_outbox FOR EACH ROW EXECUTE FUNCTION private.guard_lh_outbox_command();
--> statement-breakpoint
CREATE TRIGGER lh_runs_set_updated_at BEFORE UPDATE ON public.lh_runs FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER lh_jobs_set_updated_at BEFORE UPDATE ON public.lh_jobs FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER lh_source_candidates_set_updated_at BEFORE UPDATE ON public.lh_source_candidates FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER lh_website_audits_set_updated_at BEFORE UPDATE ON public.lh_website_audits FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER lh_message_versions_set_updated_at BEFORE UPDATE ON public.lh_message_versions FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER lh_outbox_set_updated_at BEFORE UPDATE ON public.lh_outbox FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
