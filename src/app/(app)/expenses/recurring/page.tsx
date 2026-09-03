import Link from "next/link";

import { RecurringExpenseList } from "@/components/expenses/recurring-expense-list";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";
import { getRecurringExpenses } from "@/lib/queries/expenses";

export default async function RecurringExpensesPage() {
  const recurringExpenses = await getRecurringExpenses();

  return (
    <main className="charges-page">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="eyebrow">Reglas de proyección</p>
          <h1>Gastos recurrentes</h1>
          <p>Plantillas que mantienen próximos vencimientos sin duplicarlos.</p>
        </div>
        <Link className="primary-button" href="/expenses/new?recurring=true">Nueva recurrencia</Link>
      </header>
      <section className="form-sheet" aria-labelledby="recurring-expenses-heading">
        <header className="form-sheet__heading">
          <span>01</span>
          <div>
            <h2 id="recurring-expenses-heading">Reglas registradas</h2>
            <p>{recurringExpenses.length} {recurringExpenses.length === 1 ? "regla" : "reglas"} en el libro.</p>
          </div>
        </header>
        <RecurringExpenseList
          recurringExpenses={recurringExpenses}
          today={todayInBusinessZone(new Date())}
        />
      </section>
    </main>
  );
}
