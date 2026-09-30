CREATE TYPE "public"."lh_actor_type" AS ENUM('human', 'system', 'agent');--> statement-breakpoint
CREATE TYPE "public"."lh_automation_mode" AS ENUM('drafts', 'automatic');--> statement-breakpoint
CREATE TYPE "public"."lh_campaign_status" AS ENUM('draft', 'active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."lh_enrollment_status" AS ENUM('researching', 'ready', 'contacting', 'replied', 'completed', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."lh_evaluation" AS ENUM('pending', 'eligible', 'excluded', 'needs_review', 'no_email');--> statement-breakpoint
CREATE TYPE "public"."lh_evidence_kind" AS ENUM('fact', 'hypothesis');--> statement-breakpoint
CREATE TYPE "public"."lh_lead_status" AS ENUM('new', 'researching', 'qualified', 'excluded', 'converted', 'archived');--> statement-breakpoint
CREATE TABLE "lh_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"campaign_id" uuid,
	"lead_id" uuid,
	"actor_type" "lh_actor_type" NOT NULL,
	"event_type" text NOT NULL,
	"detail" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lh_activity_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "lh_activity_event_type_not_blank" CHECK (btrim("lh_activity"."event_type") <> '')
);
--> statement-breakpoint
ALTER TABLE "lh_activity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lh_campaign_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lh_campaign_versions_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "lh_campaign_versions_number_unique" UNIQUE("owner_id","campaign_id","version"),
	CONSTRAINT "lh_campaign_versions_version_positive" CHECK ("lh_campaign_versions"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "lh_campaign_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lh_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"objective" text NOT NULL,
	"service_focus" text NOT NULL,
	"status" "lh_campaign_status" DEFAULT 'draft' NOT NULL,
	"automation_mode" "lh_automation_mode" DEFAULT 'drafts' NOT NULL,
	"mailbox_id" uuid,
	"countries" jsonb NOT NULL,
	"sources" jsonb NOT NULL,
	"positive_criteria" jsonb NOT NULL,
	"negative_criteria" jsonb NOT NULL,
	"schedule" jsonb NOT NULL,
	"sequence_steps" jsonb NOT NULL,
	"daily_lead_limit" integer NOT NULL,
	"daily_email_limit" integer NOT NULL,
	"config_version" integer DEFAULT 1 NOT NULL,
	"next_search_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lh_campaigns_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "lh_campaigns_name_not_blank" CHECK (btrim("lh_campaigns"."name") <> ''),
	CONSTRAINT "lh_campaigns_objective_not_blank" CHECK (btrim("lh_campaigns"."objective") <> ''),
	CONSTRAINT "lh_campaigns_daily_lead_limit_positive" CHECK ("lh_campaigns"."daily_lead_limit" > 0),
	CONSTRAINT "lh_campaigns_daily_email_limit_positive" CHECK ("lh_campaigns"."daily_email_limit" > 0),
	CONSTRAINT "lh_campaigns_config_version_positive" CHECK ("lh_campaigns"."config_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "lh_campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lh_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"first_name" text,
	"last_name" text,
	"role" text,
	"email" text,
	"normalized_email" text,
	"phone" text,
	"source_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lh_contacts_owner_id_id_unique" UNIQUE("owner_id","id")
);
--> statement-breakpoint
ALTER TABLE "lh_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lh_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"campaign_version" integer NOT NULL,
	"evaluation" "lh_evaluation" DEFAULT 'pending' NOT NULL,
	"status" "lh_enrollment_status" DEFAULT 'researching' NOT NULL,
	"score" smallint,
	"reason" text,
	"next_action_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lh_enrollments_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "lh_enrollments_campaign_lead_unique" UNIQUE("owner_id","campaign_id","lead_id"),
	CONSTRAINT "lh_enrollments_campaign_version_positive" CHECK ("lh_enrollments"."campaign_version" > 0),
	CONSTRAINT "lh_enrollments_score_range" CHECK ("lh_enrollments"."score" is null or "lh_enrollments"."score" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "lh_enrollments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lh_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"kind" "lh_evidence_kind" NOT NULL,
	"source_type" text NOT NULL,
	"source_url" text,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"confidence" smallint NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lh_evidence_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "lh_evidence_field_not_blank" CHECK (btrim("lh_evidence"."field") <> ''),
	CONSTRAINT "lh_evidence_value_not_blank" CHECK (btrim("lh_evidence"."value") <> ''),
	CONSTRAINT "lh_evidence_confidence_range" CHECK ("lh_evidence"."confidence" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "lh_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lh_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"domain" text,
	"website" text,
	"country_code" text,
	"city" text,
	"description" text,
	"status" "lh_lead_status" DEFAULT 'new' NOT NULL,
	"linked_client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lh_leads_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "lh_leads_name_not_blank" CHECK (btrim("lh_leads"."name") <> ''),
	CONSTRAINT "lh_leads_normalized_name_not_blank" CHECK (btrim("lh_leads"."normalized_name") <> ''),
	CONSTRAINT "lh_leads_country_code_format" CHECK ("lh_leads"."country_code" is null or "lh_leads"."country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
ALTER TABLE "lh_leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lh_activity" ADD CONSTRAINT "lh_activity_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_activity" ADD CONSTRAINT "lh_activity_owner_campaign_campaigns_owner_id_id_fk" FOREIGN KEY ("owner_id","campaign_id") REFERENCES "public"."lh_campaigns"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_activity" ADD CONSTRAINT "lh_activity_owner_lead_leads_owner_id_id_fk" FOREIGN KEY ("owner_id","lead_id") REFERENCES "public"."lh_leads"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_campaign_versions" ADD CONSTRAINT "lh_campaign_versions_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_campaign_versions" ADD CONSTRAINT "lh_campaign_versions_owner_campaign_campaigns_owner_id_id_fk" FOREIGN KEY ("owner_id","campaign_id") REFERENCES "public"."lh_campaigns"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_campaigns" ADD CONSTRAINT "lh_campaigns_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_contacts" ADD CONSTRAINT "lh_contacts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_contacts" ADD CONSTRAINT "lh_contacts_owner_lead_leads_owner_id_id_fk" FOREIGN KEY ("owner_id","lead_id") REFERENCES "public"."lh_leads"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_enrollments" ADD CONSTRAINT "lh_enrollments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_enrollments" ADD CONSTRAINT "lh_enrollments_owner_campaign_campaigns_owner_id_id_fk" FOREIGN KEY ("owner_id","campaign_id") REFERENCES "public"."lh_campaigns"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_enrollments" ADD CONSTRAINT "lh_enrollments_owner_lead_leads_owner_id_id_fk" FOREIGN KEY ("owner_id","lead_id") REFERENCES "public"."lh_leads"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_evidence" ADD CONSTRAINT "lh_evidence_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_evidence" ADD CONSTRAINT "lh_evidence_owner_lead_leads_owner_id_id_fk" FOREIGN KEY ("owner_id","lead_id") REFERENCES "public"."lh_leads"("owner_id","id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_leads" ADD CONSTRAINT "lh_leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "lh_leads" ADD CONSTRAINT "lh_leads_owner_client_clients_owner_id_id_fk" FOREIGN KEY ("owner_id","linked_client_id") REFERENCES "public"."clients"("owner_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "lh_activity_owner_campaign_occurred_idx" ON "lh_activity" USING btree ("owner_id","campaign_id","occurred_at");--> statement-breakpoint
CREATE INDEX "lh_activity_owner_lead_occurred_idx" ON "lh_activity" USING btree ("owner_id","lead_id","occurred_at");--> statement-breakpoint
CREATE INDEX "lh_campaigns_owner_status_idx" ON "lh_campaigns" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "lh_campaigns_owner_next_search_idx" ON "lh_campaigns" USING btree ("owner_id","next_search_at");--> statement-breakpoint
CREATE INDEX "lh_contacts_owner_lead_idx" ON "lh_contacts" USING btree ("owner_id","lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lh_contacts_owner_email_unique" ON "lh_contacts" USING btree ("owner_id","normalized_email") WHERE "lh_contacts"."normalized_email" is not null;--> statement-breakpoint
CREATE INDEX "lh_enrollments_owner_campaign_status_idx" ON "lh_enrollments" USING btree ("owner_id","campaign_id","status");--> statement-breakpoint
CREATE INDEX "lh_enrollments_owner_next_action_idx" ON "lh_enrollments" USING btree ("owner_id","next_action_at");--> statement-breakpoint
CREATE INDEX "lh_evidence_owner_lead_idx" ON "lh_evidence" USING btree ("owner_id","lead_id");--> statement-breakpoint
CREATE INDEX "lh_leads_owner_status_idx" ON "lh_leads" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "lh_leads_owner_name_idx" ON "lh_leads" USING btree ("owner_id","normalized_name");--> statement-breakpoint
CREATE POLICY "lh_activity_authenticated_select" ON "lh_activity" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "lh_activity"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_activity_backend_insert" ON "lh_activity" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "lh_activity"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_activity_backend_update" ON "lh_activity" AS PERMISSIVE FOR UPDATE TO "kazeos_backend" USING ((select auth.uid()) = "lh_activity"."owner_id") WITH CHECK ((select auth.uid()) = "lh_activity"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_campaign_versions_authenticated_select" ON "lh_campaign_versions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "lh_campaign_versions"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_campaign_versions_backend_insert" ON "lh_campaign_versions" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "lh_campaign_versions"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_campaign_versions_backend_update" ON "lh_campaign_versions" AS PERMISSIVE FOR UPDATE TO "kazeos_backend" USING ((select auth.uid()) = "lh_campaign_versions"."owner_id") WITH CHECK ((select auth.uid()) = "lh_campaign_versions"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_campaigns_authenticated_select" ON "lh_campaigns" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "lh_campaigns"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_campaigns_backend_insert" ON "lh_campaigns" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "lh_campaigns"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_campaigns_backend_update" ON "lh_campaigns" AS PERMISSIVE FOR UPDATE TO "kazeos_backend" USING ((select auth.uid()) = "lh_campaigns"."owner_id") WITH CHECK ((select auth.uid()) = "lh_campaigns"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_contacts_authenticated_select" ON "lh_contacts" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "lh_contacts"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_contacts_backend_insert" ON "lh_contacts" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "lh_contacts"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_contacts_backend_update" ON "lh_contacts" AS PERMISSIVE FOR UPDATE TO "kazeos_backend" USING ((select auth.uid()) = "lh_contacts"."owner_id") WITH CHECK ((select auth.uid()) = "lh_contacts"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_enrollments_authenticated_select" ON "lh_enrollments" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "lh_enrollments"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_enrollments_backend_insert" ON "lh_enrollments" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "lh_enrollments"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_enrollments_backend_update" ON "lh_enrollments" AS PERMISSIVE FOR UPDATE TO "kazeos_backend" USING ((select auth.uid()) = "lh_enrollments"."owner_id") WITH CHECK ((select auth.uid()) = "lh_enrollments"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_evidence_authenticated_select" ON "lh_evidence" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "lh_evidence"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_evidence_backend_insert" ON "lh_evidence" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "lh_evidence"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_evidence_backend_update" ON "lh_evidence" AS PERMISSIVE FOR UPDATE TO "kazeos_backend" USING ((select auth.uid()) = "lh_evidence"."owner_id") WITH CHECK ((select auth.uid()) = "lh_evidence"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_leads_authenticated_select" ON "lh_leads" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "lh_leads"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_leads_backend_insert" ON "lh_leads" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "lh_leads"."owner_id");--> statement-breakpoint
CREATE POLICY "lh_leads_backend_update" ON "lh_leads" AS PERMISSIVE FOR UPDATE TO "kazeos_backend" USING ((select auth.uid()) = "lh_leads"."owner_id") WITH CHECK ((select auth.uid()) = "lh_leads"."owner_id");
--> statement-breakpoint
REVOKE ALL ON TABLE public.lh_campaigns, public.lh_campaign_versions, public.lh_leads, public.lh_contacts, public.lh_evidence, public.lh_enrollments, public.lh_activity FROM public, anon, authenticated;
--> statement-breakpoint
GRANT SELECT ON TABLE public.lh_campaigns, public.lh_campaign_versions, public.lh_leads, public.lh_contacts, public.lh_evidence, public.lh_enrollments, public.lh_activity TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.lh_campaigns, public.lh_campaign_versions, public.lh_leads, public.lh_contacts, public.lh_evidence, public.lh_enrollments, public.lh_activity TO kazeos_backend;
--> statement-breakpoint
CREATE TRIGGER lh_campaigns_set_updated_at BEFORE UPDATE ON public.lh_campaigns FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER lh_leads_set_updated_at BEFORE UPDATE ON public.lh_leads FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER lh_contacts_set_updated_at BEFORE UPDATE ON public.lh_contacts FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER lh_evidence_set_updated_at BEFORE UPDATE ON public.lh_evidence FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
--> statement-breakpoint
CREATE TRIGGER lh_enrollments_set_updated_at BEFORE UPDATE ON public.lh_enrollments FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
