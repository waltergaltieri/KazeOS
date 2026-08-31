ALTER TABLE "charges" DROP CONSTRAINT "charges_amount_paid_minor_valid";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_recurrence_consistency";--> statement-breakpoint
ALTER TABLE "charges" DROP CONSTRAINT "charges_owner_id_service_id_services_owner_id_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_owner_id_charge_id_charges_owner_id_id_fk";
--> statement-breakpoint
DROP INDEX "charges_owner_id_service_id_idx";--> statement-breakpoint
DROP INDEX "client_notes_owner_id_client_id_idx";--> statement-breakpoint
DROP INDEX "payments_owner_id_charge_id_idx";--> statement-breakpoint
ALTER TABLE "clients" ALTER COLUMN "joined_at" SET DEFAULT (now() at time zone 'America/Argentina/Buenos_Aires')::date;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_id_owner_id_client_id_unique" UNIQUE("id","owner_id","client_id");--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_id_owner_client_currency_unique" UNIQUE("id","owner_id","client_id","currency");--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_service_owner_client_services_id_owner_client_fk" FOREIGN KEY ("service_id","owner_id","client_id") REFERENCES "public"."services"("id","owner_id","client_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_charge_owner_client_currency_charges_fk" FOREIGN KEY ("charge_id","owner_id","client_id","currency") REFERENCES "public"."charges"("id","owner_id","client_id","currency") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "charges_service_owner_client_idx" ON "charges" USING btree ("service_id","owner_id","client_id");--> statement-breakpoint
CREATE INDEX "client_notes_owner_client_created_idx" ON "client_notes" USING btree ("owner_id","client_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_charge_owner_client_currency_idx" ON "payments" USING btree ("charge_id","owner_id","client_id","currency");--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_amount_minor_js_safe" CHECK ("charges"."amount_minor" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_status_amount_paid_consistency" CHECK ((
        "charges"."status" = 'cancelled'
        or ("charges"."status" = 'pending' and "charges"."amount_paid_minor" = 0)
        or ("charges"."status" = 'partial' and "charges"."amount_paid_minor" > 0 and "charges"."amount_paid_minor" < "charges"."amount_minor")
        or ("charges"."status" = 'paid' and "charges"."amount_paid_minor" >= "charges"."amount_minor")
      ));--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_amount_paid_minor_valid" CHECK ("charges"."amount_paid_minor" >= 0 and "charges"."amount_paid_minor" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_minor_js_safe" CHECK ("payments"."amount_minor" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_amount_minor_js_safe" CHECK ("services"."amount_minor" <= 9007199254740991);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_consistency" CHECK ((
        ("tasks"."recurring" = true and "tasks"."recurrence" is not null and "tasks"."parent_id" is null and "tasks"."recurrence_key" is null)
        or
        ("tasks"."recurring" = false and "tasks"."recurrence" is null and "tasks"."parent_id" is null and "tasks"."recurrence_key" is null)
        or
        ("tasks"."recurring" = false and "tasks"."recurrence" is null and "tasks"."parent_id" is not null and "tasks"."recurrence_key" is not null and btrim("tasks"."recurrence_key") <> '')
      ));--> statement-breakpoint
DROP POLICY "charges_authenticated_owner_access" ON "charges" CASCADE;--> statement-breakpoint
DROP POLICY "client_notes_authenticated_owner_access" ON "client_notes" CASCADE;--> statement-breakpoint
DROP POLICY "clients_authenticated_owner_access" ON "clients" CASCADE;--> statement-breakpoint
DROP POLICY "payments_authenticated_owner_access" ON "payments" CASCADE;--> statement-breakpoint
DROP POLICY "profiles_authenticated_access" ON "profiles" CASCADE;--> statement-breakpoint
DROP POLICY "services_authenticated_owner_access" ON "services" CASCADE;--> statement-breakpoint
DROP POLICY "settings_authenticated_owner_access" ON "settings" CASCADE;--> statement-breakpoint
DROP POLICY "tasks_authenticated_owner_access" ON "tasks" CASCADE;--> statement-breakpoint
CREATE POLICY "charges_authenticated_select" ON "charges" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "charges"."owner_id");--> statement-breakpoint
CREATE POLICY "charges_authenticated_insert" ON "charges" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "charges"."owner_id");--> statement-breakpoint
CREATE POLICY "charges_authenticated_update" ON "charges" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "charges"."owner_id") WITH CHECK ((select auth.uid()) = "charges"."owner_id");--> statement-breakpoint
CREATE POLICY "client_notes_authenticated_select" ON "client_notes" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "client_notes"."owner_id");--> statement-breakpoint
CREATE POLICY "client_notes_authenticated_insert" ON "client_notes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "client_notes"."owner_id");--> statement-breakpoint
CREATE POLICY "client_notes_authenticated_update" ON "client_notes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "client_notes"."owner_id") WITH CHECK ((select auth.uid()) = "client_notes"."owner_id");--> statement-breakpoint
CREATE POLICY "client_notes_authenticated_delete" ON "client_notes" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.uid()) = "client_notes"."owner_id");--> statement-breakpoint
CREATE POLICY "clients_authenticated_select" ON "clients" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "clients"."owner_id");--> statement-breakpoint
CREATE POLICY "clients_authenticated_insert" ON "clients" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "clients"."owner_id");--> statement-breakpoint
CREATE POLICY "clients_authenticated_update" ON "clients" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "clients"."owner_id") WITH CHECK ((select auth.uid()) = "clients"."owner_id");--> statement-breakpoint
CREATE POLICY "payments_authenticated_select" ON "payments" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "payments"."owner_id");--> statement-breakpoint
CREATE POLICY "payments_authenticated_insert" ON "payments" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "payments"."owner_id");--> statement-breakpoint
CREATE POLICY "payments_authenticated_update" ON "payments" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "payments"."owner_id") WITH CHECK ((select auth.uid()) = "payments"."owner_id");--> statement-breakpoint
CREATE POLICY "profiles_authenticated_select" ON "profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "profiles"."id");--> statement-breakpoint
CREATE POLICY "profiles_authenticated_insert" ON "profiles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "profiles"."id");--> statement-breakpoint
CREATE POLICY "profiles_authenticated_update" ON "profiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "profiles"."id") WITH CHECK ((select auth.uid()) = "profiles"."id");--> statement-breakpoint
CREATE POLICY "services_authenticated_select" ON "services" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "services"."owner_id");--> statement-breakpoint
CREATE POLICY "services_authenticated_insert" ON "services" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "services"."owner_id");--> statement-breakpoint
CREATE POLICY "services_authenticated_update" ON "services" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "services"."owner_id") WITH CHECK ((select auth.uid()) = "services"."owner_id");--> statement-breakpoint
CREATE POLICY "settings_authenticated_select" ON "settings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "settings"."owner_id");--> statement-breakpoint
CREATE POLICY "settings_authenticated_insert" ON "settings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "settings"."owner_id");--> statement-breakpoint
CREATE POLICY "settings_authenticated_update" ON "settings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "settings"."owner_id") WITH CHECK ((select auth.uid()) = "settings"."owner_id");--> statement-breakpoint
CREATE POLICY "tasks_authenticated_select" ON "tasks" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = "tasks"."owner_id");--> statement-breakpoint
CREATE POLICY "tasks_authenticated_insert" ON "tasks" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ((select auth.uid()) = "tasks"."owner_id");--> statement-breakpoint
CREATE POLICY "tasks_authenticated_update" ON "tasks" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ((select auth.uid()) = "tasks"."owner_id") WITH CHECK ((select auth.uid()) = "tasks"."owner_id");--> statement-breakpoint
CREATE POLICY "tasks_authenticated_delete" ON "tasks" AS PERMISSIVE FOR DELETE TO "authenticated" USING ((select auth.uid()) = "tasks"."owner_id");

-- Keep privileged trigger helpers outside the API-exposed schemas.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.guard_charge_payment_totals()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  payment_total bigint;
BEGIN
  SELECT COALESCE(SUM(payment.amount_minor), 0)::bigint
    INTO payment_total
    FROM public.payments AS payment
   WHERE payment.charge_id = NEW.id;

  IF NEW.amount_paid_minor <> payment_total THEN
    RAISE EXCEPTION 'charge amount_paid_minor must equal its allocated payment total'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.recompute_charge_payment_totals(p_charge_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  charge_amount bigint;
  current_status public.charge_status;
  payment_total bigint;
BEGIN
  IF p_charge_id IS NULL THEN
    RETURN;
  END IF;

  SELECT charge.amount_minor, charge.status
    INTO charge_amount, current_status
    FROM public.charges AS charge
   WHERE charge.id = p_charge_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(payment.amount_minor), 0)::bigint
    INTO payment_total
    FROM public.payments AS payment
   WHERE payment.charge_id = p_charge_id;

  IF payment_total > 9007199254740991 THEN
    RAISE EXCEPTION 'allocated payment total exceeds the JavaScript-safe integer range'
      USING ERRCODE = '22003';
  END IF;

  UPDATE public.charges
     SET amount_paid_minor = payment_total,
         status = CASE
           WHEN current_status = 'cancelled' THEN 'cancelled'::public.charge_status
           WHEN payment_total = 0 THEN 'pending'::public.charge_status
           WHEN payment_total < charge_amount THEN 'partial'::public.charge_status
           ELSE 'paid'::public.charge_status
         END
   WHERE id = p_charge_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.sync_charge_from_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_charge_id uuid := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.charge_id END;
  new_charge_id uuid := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.charge_id END;
BEGIN
  -- Stable lock ordering prevents concurrent payment moves from deadlocking.
  IF old_charge_id IS NOT NULL
     AND new_charge_id IS NOT NULL
     AND old_charge_id <> new_charge_id THEN
    IF old_charge_id::text < new_charge_id::text THEN
      PERFORM private.recompute_charge_payment_totals(old_charge_id);
      PERFORM private.recompute_charge_payment_totals(new_charge_id);
    ELSE
      PERFORM private.recompute_charge_payment_totals(new_charge_id);
      PERFORM private.recompute_charge_payment_totals(old_charge_id);
    END IF;
  ELSE
    PERFORM private.recompute_charge_payment_totals(COALESCE(new_charge_id, old_charge_id));
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION private.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_charge_payment_totals() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.recompute_charge_payment_totals(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.sync_charge_from_payments() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.set_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER charges_guard_payment_totals
BEFORE INSERT OR UPDATE OF amount_paid_minor, status ON public.charges
FOR EACH ROW EXECUTE FUNCTION private.guard_charge_payment_totals();

CREATE TRIGGER payments_sync_charge_totals
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION private.sync_charge_from_payments();

CREATE TRIGGER profiles_set_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER clients_set_updated_at
BEFORE UPDATE ON public.clients
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER services_set_updated_at
BEFORE UPDATE ON public.services
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER charges_set_updated_at
BEFORE UPDATE ON public.charges
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER payments_set_updated_at
BEFORE UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER tasks_set_updated_at
BEFORE UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER client_notes_set_updated_at
BEFORE UPDATE ON public.client_notes
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER settings_set_updated_at
BEFORE UPDATE ON public.settings
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- The profile email is a display snapshot; auth.users.email remains authoritative.
COMMENT ON COLUMN public.profiles.email IS
  'Display snapshot only; auth.users.email is authoritative for authentication.';

-- Explicit table ACLs backstop RLS and retain financial and archival history.
REVOKE ALL ON TABLE
  public.profiles,
  public.clients,
  public.services,
  public.charges,
  public.payments,
  public.tasks,
  public.client_notes,
  public.settings
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE
  public.profiles,
  public.clients,
  public.services,
  public.charges,
  public.payments,
  public.settings
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.tasks,
  public.client_notes
TO authenticated;
