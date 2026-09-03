import { notFound } from "next/navigation";

import { ExpenseForm, type ExpenseFormDefaults } from "@/components/expenses/expense-form";
import { updateExpenseAction } from "@/lib/actions/expenses";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";
import { getExpenseById, getExpenseFormOptions } from "@/lib/queries/expenses";

export default async function EditExpensePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const today = todayInBusinessZone(new Date());
  const [expense, options] = await Promise.all([
    getExpenseById(id, today),
    getExpenseFormOptions({ includeInactive: true }),
  ]);

  if (
    !expense ||
    expense.generatedAutomatically ||
    expense.recurringExpense !== null ||
    (expense.persistedStatus !== "planned" && expense.persistedStatus !== "pending")
  ) {
    notFound();
  }

  const defaults: ExpenseFormDefaults = {
    id: expense.id,
    title: expense.title,
    description: expense.description,
    amountMinor: expense.amountMinor,
    currency: expense.currency,
    categoryId: expense.category.id,
    scope: expense.scope,
    costType: expense.costType,
    dueDate: expense.dueDate,
    paidDate: expense.paidDate,
    status: expense.persistedStatus,
    paymentMethod: expense.paymentMethod,
    vendor: expense.vendor,
    notes: expense.notes,
  };

  return (
    <main className="charge-editor-page">
      <header className="page-heading">
        <p className="eyebrow">Corrección de asiento manual</p>
        <h1>Editar gasto</h1>
        <p>La corrección conserva la identidad y el historial de la obligación.</p>
      </header>
      <ExpenseForm
        oneOffAction={updateExpenseAction}
        categories={options.categories}
        defaults={defaults}
        mode="edit"
      />
    </main>
  );
}
