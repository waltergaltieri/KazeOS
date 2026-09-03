ALTER POLICY "expenses_backend_delete" ON "expenses" TO kazeos_backend USING ((select auth.uid()) = "expenses"."owner_id"
        and "expenses"."status" in ('planned', 'pending')
        and (
          ("expenses"."recurring_expense_id" is null and "expenses"."generated_automatically" = false)
          or
          ("expenses"."recurring_expense_id" is not null and "expenses"."generated_automatically" = true)
        ));