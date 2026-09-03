ALTER POLICY "expenses_backend_delete"
ON "public"."expenses"
TO "kazeos_backend"
USING (
  (SELECT auth.uid()) = owner_id
  AND status IN ('planned', 'pending')
  AND (
    (recurring_expense_id IS NULL AND generated_automatically = false)
    OR
    (recurring_expense_id IS NOT NULL AND generated_automatically = true)
  )
);
