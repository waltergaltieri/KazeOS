import { notFound } from "next/navigation";

import { ExpenseForm, type ExpenseFormDefaults } from "@/components/expenses/expense-form";
import { updateRecurringExpenseAction } from "@/lib/actions/recurring-expenses";
import { buildRecurringPeriods } from "@/lib/domain/recurrence";
import { getExpenseFormOptions, getRecurringExpenseById } from "@/lib/queries/expenses";

export default async function EditRecurringExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [recurringExpense, options] = await Promise.all([
    getRecurringExpenseById(id),
    getExpenseFormOptions({ includeInactive: true }),
  ]);
  if (!recurringExpense || recurringExpense.status === "cancelled") notFound();

  const firstDueDate = recurringExpense.frequency === "one_time"
    ? recurringExpense.startDate
    : buildRecurringPeriods({
        amountMinor: recurringExpense.amountMinor,
        billingDay: recurringExpense.billingDay,
        endDate: recurringExpense.endDate,
        frequency: recurringExpense.frequency,
        label: recurringExpense.title,
        startDate: recurringExpense.startDate,
      }, recurringExpense.startDate, 13)[0]?.dueDate ?? recurringExpense.startDate;

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
        recurringAction={updateRecurringExpenseAction}
        categories={options.categories}
        defaults={defaults}
        mode="recurring-edit"
        forceRecurring
      />
    </main>
  );
}
