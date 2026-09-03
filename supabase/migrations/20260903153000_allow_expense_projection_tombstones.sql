CREATE OR REPLACE FUNCTION private.guard_expense_history()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  allowed_projection_tombstone boolean;
BEGIN
  IF OLD.status = 'paid' AND NEW.status <> 'paid' THEN
    RAISE EXCEPTION 'paid expenses must remain paid'
      USING ERRCODE = '23514';
  END IF;

  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'cancelled expenses must remain cancelled'
      USING ERRCODE = '23514';
  END IF;

  allowed_projection_tombstone :=
    OLD.generated_automatically = true
    AND OLD.recurring_expense_id IS NOT NULL
    AND OLD.status IN ('planned', 'pending')
    AND NEW.status = 'cancelled'
    AND NEW.generated_automatically IS NOT DISTINCT FROM OLD.generated_automatically
    AND NEW.recurring_expense_id IS NOT DISTINCT FROM OLD.recurring_expense_id
    AND NEW.period_key IS NOT DISTINCT FROM (
      COALESCE(OLD.period_key, 'period') || ':superseded:' || OLD.id::text
    );

  IF NEW.generated_automatically IS DISTINCT FROM OLD.generated_automatically
     OR NEW.recurring_expense_id IS DISTINCT FROM OLD.recurring_expense_id
     OR (
       NEW.period_key IS DISTINCT FROM OLD.period_key
       AND NOT allowed_projection_tombstone
     ) THEN
    RAISE EXCEPTION 'expense generation identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.guard_expense_history()
FROM PUBLIC, anon, authenticated;
