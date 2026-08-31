CREATE TYPE "public"."billing_frequency" AS ENUM('monthly', 'quarterly', 'yearly', 'one_time');--> statement-breakpoint
CREATE TYPE "public"."billing_type" AS ENUM('recurring', 'one_time');--> statement-breakpoint
CREATE TYPE "public"."charge_status" AS ENUM('pending', 'partial', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."client_status" AS ENUM('active', 'paused', 'archived');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('USD', 'ARS');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('bank_transfer', 'cash', 'mercadopago', 'paypal', 'payoneer', 'stripe', 'crypto', 'other');--> statement-breakpoint
CREATE TYPE "public"."service_status" AS ENUM('active', 'paused', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."task_recurrence" AS ENUM('monthly');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'completed');--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"service_id" uuid,
	"description" text NOT NULL,
	"period_key" text,
	"amount_minor" bigint NOT NULL,
	"currency" "currency" NOT NULL,
	"due_date" date NOT NULL,
	"status" charge_status DEFAULT 'pending' NOT NULL,
	"amount_paid_minor" bigint DEFAULT 0 NOT NULL,
	"generated_automatically" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charges_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "charges_description_not_blank" CHECK (btrim("charges"."description") <> ''),
	CONSTRAINT "charges_amount_minor_positive" CHECK ("charges"."amount_minor" > 0),
	CONSTRAINT "charges_amount_paid_minor_valid" CHECK ("charges"."amount_paid_minor" >= 0 and "charges"."amount_paid_minor" <= "charges"."amount_minor"),
	CONSTRAINT "charges_period_key_consistency" CHECK ((
        ("charges"."period_key" is null or ("charges"."service_id" is not null and btrim("charges"."period_key") <> ''))
        and
        ("charges"."generated_automatically" = false or ("charges"."service_id" is not null and "charges"."period_key" is not null))
      ))
);
--> statement-breakpoint
ALTER TABLE "charges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "client_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_notes_content_not_blank" CHECK (btrim("client_notes"."content") <> '')
);
--> statement-breakpoint
ALTER TABLE "client_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"company" text,
	"email" text,
	"phone" text,
	"whatsapp" text,
	"tax_id" text,
	"website" text,
	"address" text,
	"notes" text,
	"status" "client_status" DEFAULT 'active' NOT NULL,
	"joined_at" date DEFAULT current_date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "clients_first_name_not_blank" CHECK (btrim("clients"."first_name") <> '')
);
--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"charge_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" "currency" NOT NULL,
	"payment_date" date NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"reference" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_minor_positive" CHECK ("payments"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_full_name_not_blank" CHECK (btrim("profiles"."full_name") <> ''),
	CONSTRAINT "profiles_email_not_blank" CHECK (btrim("profiles"."email") <> '')
);
--> statement-breakpoint
ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"billing_type" "billing_type" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" "currency" NOT NULL,
	"billing_frequency" "billing_frequency" NOT NULL,
	"billing_day" integer,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" "service_status" DEFAULT 'active' NOT NULL,
	"automatic_charge_generation" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "services_name_not_blank" CHECK (btrim("services"."name") <> ''),
	CONSTRAINT "services_amount_minor_positive" CHECK ("services"."amount_minor" > 0),
	CONSTRAINT "services_billing_day_range" CHECK ("services"."billing_day" is null or "services"."billing_day" between 1 and 31),
	CONSTRAINT "services_end_date_valid" CHECK ("services"."end_date" is null or "services"."end_date" >= "services"."start_date"),
	CONSTRAINT "services_billing_consistency" CHECK ((
        ("services"."billing_type" = 'one_time' and "services"."billing_frequency" = 'one_time' and "services"."billing_day" is null and "services"."automatic_charge_generation" = false)
        or
        ("services"."billing_type" = 'recurring' and "services"."billing_frequency" <> 'one_time' and "services"."billing_day" is not null)
      ))
);
--> statement-breakpoint
ALTER TABLE "services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "settings" (
	"owner_id" uuid PRIMARY KEY NOT NULL,
	"primary_currency" "currency" DEFAULT 'USD' NOT NULL,
	"timezone" text DEFAULT 'America/Argentina/Buenos_Aires' NOT NULL,
	"date_format" text DEFAULT 'dd/MM/yyyy' NOT NULL,
	"business_name" text,
	"business_info" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_timezone_not_blank" CHECK (btrim("settings"."timezone") <> ''),
	CONSTRAINT "settings_date_format_not_blank" CHECK (btrim("settings"."date_format") <> '')
);
--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"client_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"due_date" date,
	"priority" "task_priority" DEFAULT 'medium' NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"recurring" boolean DEFAULT false NOT NULL,
	"recurrence" "task_recurrence",
	"recurrence_key" text,
	"parent_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "tasks_title_not_blank" CHECK (btrim("tasks"."title") <> ''),
	CONSTRAINT "tasks_recurrence_consistency" CHECK ((
        ("tasks"."recurring" = true and "tasks"."recurrence" is not null and "tasks"."parent_id" is null and "tasks"."recurrence_key" is null)
        or
        ("tasks"."recurring" = false and "tasks"."recurrence" is null and "tasks"."parent_id" is null and "tasks"."recurrence_key" is null)
        or
        ("tasks"."recurring" = false and "tasks"."recurrence" is null and "tasks"."parent_id" is not null and btrim("tasks"."recurrence_key") <> '')
      )),
	CONSTRAINT "tasks_completion_consistency" CHECK ((
        ("tasks"."status" = 'pending' and "tasks"."completed_at" is null)
        or
        ("tasks"."status" = 'completed' and "tasks"."completed_at" is not null)
      ))
);
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_owner_id_client_id_clients_owner_id_id_fk" FOREIGN KEY ("owner_id","client_id") REFERENCES "public"."clients"("owner_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_owner_id_service_id_services_owner_id_id_fk" FOREIGN KEY ("owner_id","service_id") REFERENCES "public"."services"("owner_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "client_notes" ADD CONSTRAINT "client_notes_owner_id_client_id_clients_owner_id_id_fk" FOREIGN KEY ("owner_id","client_id") REFERENCES "public"."clients"("owner_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_owner_id_client_id_clients_owner_id_id_fk" FOREIGN KEY ("owner_id","client_id") REFERENCES "public"."clients"("owner_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_owner_id_charge_id_charges_owner_id_id_fk" FOREIGN KEY ("owner_id","charge_id") REFERENCES "public"."charges"("owner_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_id_users_id_fk" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_owner_id_client_id_clients_owner_id_id_fk" FOREIGN KEY ("owner_id","client_id") REFERENCES "public"."clients"("owner_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_id_client_id_clients_owner_id_id_fk" FOREIGN KEY ("owner_id","client_id") REFERENCES "public"."clients"("owner_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_id_parent_id_tasks_owner_id_id_fk" FOREIGN KEY ("owner_id","parent_id") REFERENCES "public"."tasks"("owner_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "charges_owner_id_client_id_idx" ON "charges" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE INDEX "charges_owner_id_service_id_idx" ON "charges" USING btree ("owner_id","service_id");--> statement-breakpoint
CREATE INDEX "charges_owner_id_due_date_idx" ON "charges" USING btree ("owner_id","due_date");--> statement-breakpoint
CREATE INDEX "charges_owner_id_status_due_date_idx" ON "charges" USING btree ("owner_id","status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "charges_service_id_period_key_unique" ON "charges" USING btree ("service_id","period_key") WHERE "charges"."service_id" is not null and "charges"."period_key" is not null;--> statement-breakpoint
CREATE INDEX "client_notes_owner_id_client_id_idx" ON "client_notes" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE INDEX "clients_owner_id_status_idx" ON "clients" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "payments_owner_id_client_id_idx" ON "payments" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE INDEX "payments_owner_id_charge_id_idx" ON "payments" USING btree ("owner_id","charge_id");--> statement-breakpoint
CREATE INDEX "payments_owner_id_payment_date_idx" ON "payments" USING btree ("owner_id","payment_date");--> statement-breakpoint
CREATE INDEX "services_owner_id_client_id_idx" ON "services" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE INDEX "services_owner_id_status_idx" ON "services" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "tasks_owner_id_client_id_idx" ON "tasks" USING btree ("owner_id","client_id");--> statement-breakpoint
CREATE INDEX "tasks_owner_id_parent_id_idx" ON "tasks" USING btree ("owner_id","parent_id");--> statement-breakpoint
CREATE INDEX "tasks_owner_id_status_due_date_idx" ON "tasks" USING btree ("owner_id","status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_parent_id_recurrence_key_unique" ON "tasks" USING btree ("parent_id","recurrence_key") WHERE "tasks"."parent_id" is not null and "tasks"."recurrence_key" is not null;--> statement-breakpoint
CREATE POLICY "charges_authenticated_owner_access" ON "charges" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = "charges"."owner_id") WITH CHECK ((select auth.uid()) = "charges"."owner_id");--> statement-breakpoint
CREATE POLICY "client_notes_authenticated_owner_access" ON "client_notes" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = "client_notes"."owner_id") WITH CHECK ((select auth.uid()) = "client_notes"."owner_id");--> statement-breakpoint
CREATE POLICY "clients_authenticated_owner_access" ON "clients" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = "clients"."owner_id") WITH CHECK ((select auth.uid()) = "clients"."owner_id");--> statement-breakpoint
CREATE POLICY "payments_authenticated_owner_access" ON "payments" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = "payments"."owner_id") WITH CHECK ((select auth.uid()) = "payments"."owner_id");--> statement-breakpoint
CREATE POLICY "profiles_authenticated_access" ON "profiles" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = "profiles"."id") WITH CHECK ((select auth.uid()) = "profiles"."id");--> statement-breakpoint
CREATE POLICY "services_authenticated_owner_access" ON "services" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = "services"."owner_id") WITH CHECK ((select auth.uid()) = "services"."owner_id");--> statement-breakpoint
CREATE POLICY "settings_authenticated_owner_access" ON "settings" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = "settings"."owner_id") WITH CHECK ((select auth.uid()) = "settings"."owner_id");--> statement-breakpoint
CREATE POLICY "tasks_authenticated_owner_access" ON "tasks" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = "tasks"."owner_id") WITH CHECK ((select auth.uid()) = "tasks"."owner_id");--> statement-breakpoint

REVOKE ALL ON TABLE
	"profiles",
	"clients",
	"services",
	"charges",
	"payments",
	"tasks",
	"client_notes",
	"settings"
FROM PUBLIC, "anon";--> statement-breakpoint

REVOKE ALL ON TABLE
	"profiles",
	"clients",
	"services",
	"charges",
	"payments",
	"tasks",
	"client_notes",
	"settings"
FROM "authenticated";--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
	"profiles",
	"clients",
	"services",
	"charges",
	"payments",
	"tasks",
	"client_notes",
	"settings"
TO "authenticated";
