CREATE OR REPLACE FUNCTION private.guard_expense_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'paid' AND NEW.status <> 'paid' THEN
    RAISE EXCEPTION 'paid expenses must remain paid'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'cancelled expenses must remain cancelled'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.generated_automatically IS DISTINCT FROM OLD.generated_automatically
     OR NEW.recurring_expense_id IS DISTINCT FROM OLD.recurring_expense_id
     OR NEW.period_key IS DISTINCT FROM OLD.period_key THEN
    RAISE EXCEPTION 'expense generation identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_expense_history()
FROM PUBLIC, anon, authenticated;

CREATE TRIGGER expenses_guard_history
BEFORE UPDATE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION private.guard_expense_history();

CREATE TRIGGER expense_categories_set_updated_at
BEFORE UPDATE ON public.expense_categories
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER recurring_expenses_set_updated_at
BEFORE UPDATE ON public.recurring_expenses
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TRIGGER expenses_set_updated_at
BEFORE UPDATE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
