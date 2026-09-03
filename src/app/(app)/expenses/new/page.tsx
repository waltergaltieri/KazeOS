import { ExpenseForm, type ExpenseFormDefaults } from "@/components/expenses/expense-form";
import { createExpenseAction } from "@/lib/actions/expenses";
import { createRecurringExpenseAction } from "@/lib/actions/recurring-expenses";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";
import { getExpenseById, getExpenseFormOptions } from "@/lib/queries/expenses";
import { getPrimaryCurrency } from "@/lib/queries/settings";
import { expenseIdSchema } from "@/lib/validations/expense";

function duplicateDefaults(expense: Awaited<ReturnType<typeof getExpenseById>>): ExpenseFormDefaults | undefined {
  if (!expense) return undefined;
  return {
    title: `${expense.title} — copia`,
    description: expense.description,
    amountMinor: expense.amountMinor,
    currency: expense.currency,
    categoryId: expense.category.id,
    scope: expense.scope,
    costType: expense.costType,
    dueDate: expense.dueDate,
    status: "pending",
    vendor: expense.vendor,
    notes: expense.notes,
  };
}

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: Promise<{ duplicate?: string; recurring?: string }>;
}) {
  const { duplicate, recurring } = await searchParams;
  const duplicateResult = expenseIdSchema.safeParse(duplicate);
  const duplicateId = duplicateResult.success ? duplicateResult.data : undefined;
  const forceRecurring = recurring === "true";
  const today = todayInBusinessZone(new Date());
  const [options, primaryCurrency, source] = await Promise.all([
    getExpenseFormOptions(),
    getPrimaryCurrency(),
    duplicateId ? getExpenseById(duplicateId, today) : Promise.resolve(null),
  ]);
  const defaults = duplicateDefaults(source);
  if (defaults?.categoryId && !options.categories.some((category) => category.id === defaults.categoryId)) {
    defaults.categoryId = options.categories[0]?.id;
  }

  return (
    <main className="charge-editor-page">
      <header className="page-heading">
        <p className="eyebrow">Nuevo asiento</p>
        <h1>{duplicateId ? "Duplicar gasto" : forceRecurring ? "Nueva recurrencia" : "Registrar gasto"}</h1>
        <p>Dejá visible la obligación ahora; ampliá el detalle sólo si hace falta.</p>
      </header>
      <ExpenseForm
        oneOffAction={createExpenseAction}
        recurringAction={createRecurringExpenseAction}
        categories={options.categories}
        defaultCurrency={primaryCurrency}
        defaults={defaults}
        forceRecurring={forceRecurring}
      />
    </main>
  );
}
