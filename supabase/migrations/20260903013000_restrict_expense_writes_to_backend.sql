CREATE ROLE "kazeos_backend" WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT;--> statement-breakpoint
GRANT authenticated TO kazeos_backend;--> statement-breakpoint
GRANT kazeos_backend TO postgres;--> statement-breakpoint

REVOKE INSERT, UPDATE, DELETE ON TABLE
	public.expense_categories,
	public.recurring_expenses,
	public.expenses
FROM authenticated;--> statement-breakpoint

GRANT SELECT ON TABLE
	public.expense_categories,
	public.recurring_expenses,
	public.expenses
TO authenticated;--> statement-breakpoint

GRANT INSERT, UPDATE ON TABLE
	public.expense_categories,
	public.recurring_expenses
TO kazeos_backend;--> statement-breakpoint

GRANT INSERT, UPDATE, DELETE ON TABLE
	public.expenses
TO kazeos_backend;--> statement-breakpoint

UPDATE public.expenses
SET payment_method = 'other'
WHERE status = 'paid' AND payment_method IS NULL;--> statement-breakpoint

ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_payment_method_consistency" CHECK ("status" <> 'paid' or "payment_method" is not null);--> statement-breakpoint

DROP POLICY "expense_categories_authenticated_insert" ON "expense_categories";--> statement-breakpoint
DROP POLICY "expense_categories_authenticated_update" ON "expense_categories";--> statement-breakpoint
DROP POLICY "expenses_authenticated_insert" ON "expenses";--> statement-breakpoint
DROP POLICY "expenses_authenticated_update" ON "expenses";--> statement-breakpoint
DROP POLICY "expenses_authenticated_delete" ON "expenses";--> statement-breakpoint
DROP POLICY "recurring_expenses_authenticated_insert" ON "recurring_expenses";--> statement-breakpoint
DROP POLICY "recurring_expenses_authenticated_update" ON "recurring_expenses";--> statement-breakpoint

CREATE POLICY "expense_categories_backend_insert" ON "expense_categories" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "expense_categories"."owner_id");--> statement-breakpoint
CREATE POLICY "expense_categories_backend_update" ON "expense_categories" AS PERMISSIVE FOR UPDATE TO "kazeos_backend" USING ((select auth.uid()) = "expense_categories"."owner_id") WITH CHECK ((select auth.uid()) = "expense_categories"."owner_id");--> statement-breakpoint
CREATE POLICY "expenses_backend_insert" ON "expenses" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "expenses"."owner_id");--> statement-breakpoint
CREATE POLICY "expenses_backend_update" ON "expenses" AS PERMISSIVE FOR UPDATE TO "kazeos_backend" USING ((select auth.uid()) = "expenses"."owner_id") WITH CHECK ((select auth.uid()) = "expenses"."owner_id");--> statement-breakpoint
CREATE POLICY "expenses_backend_delete" ON "expenses" AS PERMISSIVE FOR DELETE TO "kazeos_backend" USING ((select auth.uid()) = "expenses"."owner_id"
	and "expenses"."recurring_expense_id" is null
	and "expenses"."generated_automatically" = false
	and "expenses"."status" in ('planned', 'pending'));--> statement-breakpoint
CREATE POLICY "recurring_expenses_backend_insert" ON "recurring_expenses" AS PERMISSIVE FOR INSERT TO "kazeos_backend" WITH CHECK ((select auth.uid()) = "recurring_expenses"."owner_id");--> statement-breakpoint
CREATE POLICY "recurring_expenses_backend_update" ON "recurring_expenses" AS PERMISSIVE FOR UPDATE TO "kazeos_backend" USING ((select auth.uid()) = "recurring_expenses"."owner_id") WITH CHECK ((select auth.uid()) = "recurring_expenses"."owner_id");
