import { notFound } from "next/navigation";

import { ExpenseForm, type ExpenseFormDefaults } from "@/components/expenses/expense-form";
import { updateRecurringExpenseAction } from "@/lib/actions/recurring-expenses";
import { firstRecurringDueDate } from "@/lib/domain/recurrence";
import { getExpenseFormOptions, getRecurringExpenseById } from "@/lib/queries/expenses";
import { recurringExpenseIdSchema } from "@/lib/validations/expense";

export default async function EditRecurringExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const idResult = recurringExpenseIdSchema.safeParse(id);
  if (!idResult.success) notFound();
  const [recurringExpense, options] = await Promise.all([
    getRecurringExpenseById(idResult.data),
    getExpenseFormOptions({ includeInactive: true }),
  ]);
  if (!recurringExpense || recurringExpense.status === "cancelled") notFound();

  const firstDueDate = recurringExpense.frequency === "one_time"
    ? recurringExpense.startDate
    : firstRecurringDueDate({
        amountMinor: recurringExpense.amountMinor,
        billingDay: recurringExpense.billingDay,
        endDate: recurringExpense.endDate,
        frequency: recurringExpense.frequency,
        label: recurringExpense.title,
        startDate: recurringExpense.startDate,
      });

  const defaults: ExpenseFormDefaults = {
    recurringExpenseId: recurringExpense.id,
    title: recurringExpense.title,
    description: recurringExpense.description,
    amountMinor: recurringExpense.amountMinor,
    currency: recurringExpense.currency,
    categoryId: recurringExpense.category.id,
    scope: recurringExpense.scope,
    costType: recurringExpense.costType,
    dueDate: firstDueDate,
    status: "pending",
    paymentMethod: recurringExpense.paymentMethod,
    vendor: recurringExpense.vendor,
    notes: recurringExpense.notes,
    frequency: recurringExpense.frequency,
    billingDay: recurringExpense.billingDay,
    startDate: recurringExpense.startDate,
    endDate: recurringExpense.endDate,
    automaticGeneration: recurringExpense.automaticGeneration,
  };

  return (
    <main className="charge-editor-page">
      <header className="page-heading">
        <p className="eyebrow">Regla de proyección</p>
        <h1>Editar gasto recurrente</h1>
        <p>Los pagos y vencimientos históricos permanecen intactos.</p>
      </header>
      <ExpenseForm
        key={`recurring-expense-edit:${recurringExpense.id}`}
        recurringAction={updateRecurringExpenseAction}
        categories={options.categories}
        defaults={defaults}
        mode="recurring-edit"
        forceRecurring
      />
    </main>
  );
}
