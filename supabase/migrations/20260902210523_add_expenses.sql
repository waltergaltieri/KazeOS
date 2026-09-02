CREATE TYPE "public"."expense_cost_type" AS ENUM('fixed', 'variable');--> statement-breakpoint
CREATE TYPE "public"."expense_scope" AS ENUM('personal', 'business', 'family', 'friends', 'partner', 'other');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('planned', 'pending', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."recurring_expense_status" AS ENUM('active', 'paused', 'cancelled');--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'debit_card';--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'credit_card';--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_categories_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "expense_categories_name_not_blank" CHECK (btrim("expense_categories"."name") <> '')
);
--> statement-breakpoint
ALTER TABLE "expense_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"amount_minor" bigint NOT NULL,
	"currency" "currency" NOT NULL,
	"category_id" uuid NOT NULL,
	"scope" "expense_scope" NOT NULL,
	"cost_type" "expense_cost_type" NOT NULL,
	"recurring_expense_id" uuid,
	"period_key" text,
	"due_date" date NOT NULL,
	"paid_date" date,
	"status" "expense_status" DEFAULT 'pending' NOT NULL,
	"payment_method" "payment_method",
	"vendor" text,
	"notes" text,
	"generated_automatically" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "expenses_title_not_blank" CHECK (btrim("expenses"."title") <> ''),
	CONSTRAINT "expenses_amount_minor_positive" CHECK ("expenses"."amount_minor" > 0),
	CONSTRAINT "expenses_amount_minor_js_safe" CHECK ("expenses"."amount_minor" <= 9007199254740991),
	CONSTRAINT "expenses_paid_date_status_consistency" CHECK ((
        ("expenses"."status" = 'paid' and "expenses"."paid_date" is not null)
        or
        ("expenses"."status" <> 'paid' and "expenses"."paid_date" is null)
      )),
	CONSTRAINT "expenses_recurrence_consistency" CHECK ((
        ("expenses"."recurring_expense_id" is null and "expenses"."period_key" is null and "expenses"."generated_automatically" = false)
        or
        ("expenses"."recurring_expense_id" is not null and "expenses"."period_key" is not null and btrim("expenses"."period_key") <> '')
      ))
);
--> statement-breakpoint
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"amount_minor" bigint NOT NULL,
	"currency" "currency" NOT NULL,
	"category_id" uuid NOT NULL,
	"scope" "expense_scope" NOT NULL,
	"cost_type" "expense_cost_type" NOT NULL,
	"frequency" "billing_frequency" NOT NULL,
	"billing_day" integer NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"status" "recurring_expense_status" DEFAULT 'active' NOT NULL,
	"payment_method" "payment_method",
	"vendor" text,
	"notes" text,
	"automatic_generation" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_expenses_owner_id_id_unique" UNIQUE("owner_id","id"),
	CONSTRAINT "recurring_expenses_id_owner_id_unique" UNIQUE("id","owner_id"),
	CONSTRAINT "recurring_expenses_title_not_blank" CHECK (btrim("recurring_expenses"."title") <> ''),
	CONSTRAINT "recurring_expenses_amount_minor_positive" CHECK ("recurring_expenses"."amount_minor" > 0),
	CONSTRAINT "recurring_expenses_amount_minor_js_safe" CHECK ("recurring_expenses"."amount_minor" <= 9007199254740991),
	CONSTRAINT "recurring_expenses_frequency_recurring" CHECK ("recurring_expenses"."frequency" <> 'one_time'),
	CONSTRAINT "recurring_expenses_billing_day_range" CHECK ("recurring_expenses"."billing_day" between 1 and 31),
	CONSTRAINT "recurring_expenses_end_date_valid" CHECK ("recurring_expenses"."end_date" is null or "recurring_expenses"."end_date" >= "recurring_expenses"."start_date")
);
--> statement-breakpoint
ALTER TABLE "recurring_expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_owner_id_category_id_expense_categories_owner_id_id_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "public"."expense_categories"("owner_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring_expense_id_owner_id_recurring_expenses_id_owner_id_fk" FOREIGN KEY ("recurring_expense_id","owner_id") REFERENCES "public"."recurring_expenses"("id","owner_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_owner_id_category_id_expense_categories_owner_id_id_fk" FOREIGN KEY ("owner_id","category_id") REFERENCES "public"."expense_categories"("owner_id","id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_owner_name_unique" ON "expense_categories" USING btree ("owner_id",lower("name"));--> statement-breakpoint
CREATE INDEX "expenses_owner_id_due_date_idx" ON "expenses" USING btree ("owner_id","due_date");--> statement-breakpoint
CREATE INDEX "expenses_owner_id_status_due_date_idx" ON "expenses" USING btree ("owner_id","status","due_date");--> statement-breakpoint
CREATE INDEX "expenses_owner_id_category_id_idx" ON "expenses" USING btree ("owner_id","category_id");--> statement-breakpoint
CREATE INDEX "expenses_owner_id_scope_idx" ON "expenses" USING btree ("owner_id","scope");--> statement-breakpoint
CREATE INDEX "expenses_owner_id_currency_idx" ON "expenses" USING btree ("owner_id","currency");--> statement-breakpoint
CREATE INDEX "expenses_recurring_expense_id_owner_id_idx" ON "expenses" USING btree ("recurring_expense_id","owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_recurring_period_unique" ON "expenses" USING btree ("recurring_expense_id","period_key") WHERE "expenses"."recurring_expense_id" is not null and "expenses"."period_key" is not null;--> statement-breakpoint
CREATE INDEX "recurring_expenses_owner_id_status_idx" ON "recurring_expenses" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "recurring_expenses_owner_id_category_id_idx" ON "recurring_expenses" USING btree ("owner_id","category_id");--> statement-breakpoint
CREATE POLICY "expense_categories_authenticated_select" ON "expense_categories" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "expense_categories"."owner_id");--> statement-breakpoint
CREATE POLICY "expense_categories_authenticated_insert" ON "expense_categories" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "expense_categories"."owner_id");--> statement-breakpoint
CREATE POLICY "expense_categories_authenticated_update" ON "expense_categories" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "expense_categories"."owner_id") WITH CHECK ((select auth.uid()) = "expense_categories"."owner_id");--> statement-breakpoint
CREATE POLICY "expenses_authenticated_select" ON "expenses" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "expenses"."owner_id");--> statement-breakpoint
CREATE POLICY "expenses_authenticated_insert" ON "expenses" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "expenses"."owner_id");--> statement-breakpoint
CREATE POLICY "expenses_authenticated_update" ON "expenses" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "expenses"."owner_id") WITH CHECK ((select auth.uid()) = "expenses"."owner_id");--> statement-breakpoint
CREATE POLICY "expenses_authenticated_delete" ON "expenses" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.uid()) = "expenses"."owner_id"
        and "expenses"."recurring_expense_id" is null
        and "expenses"."generated_automatically" = false
        and "expenses"."status" in ('planned', 'pending'));--> statement-breakpoint
CREATE POLICY "recurring_expenses_authenticated_select" ON "recurring_expenses" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "recurring_expenses"."owner_id");--> statement-breakpoint
CREATE POLICY "recurring_expenses_authenticated_insert" ON "recurring_expenses" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "recurring_expenses"."owner_id");--> statement-breakpoint
CREATE POLICY "recurring_expenses_authenticated_update" ON "recurring_expenses" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "recurring_expenses"."owner_id") WITH CHECK ((select auth.uid()) = "recurring_expenses"."owner_id");

-- Explicit ACLs backstop RLS and keep recurring/retained records non-deletable.
REVOKE ALL ON TABLE
	public.expense_categories,
	public.recurring_expenses,
	public.expenses
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
	public.expense_categories,
	public.recurring_expenses
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
	public.expenses
TO authenticated;
