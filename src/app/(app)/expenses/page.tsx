import { CalendarClock, Plus } from "lucide-react";
import Link from "next/link";

import { ExpenseFilters, type ExpenseFilterParams } from "@/components/expenses/expense-filters";
import { ExpenseTable } from "@/components/expenses/expense-table";
import { RecurringExpenseList } from "@/components/expenses/recurring-expense-list";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";
import { getExpenseFormOptions, getExpenses, getRecurringExpenses } from "@/lib/queries/expenses";

function paginationHref(params: Record<string, string | undefined>, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== "page" && value) query.set(key, value);
  }
  query.set("page", String(page));
  return `/expenses?${query}`;
}

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const today = todayInBusinessZone(new Date());
  const filters: ExpenseFilterParams = {
    q: params.q,
    status: params.status ?? "all",
    period: params.period ?? "current_month",
    month: params.month,
    from: params.from,
    to: params.to,
    categoryId: params.categoryId,
    scope: params.scope,
    costType: params.costType,
    recurrence: params.recurrence ?? "all",
    currency: params.currency,
  };
  const [page, options, recurringExpenses] = await Promise.all([
    getExpenses({
      search: filters.q,
      status: filters.status,
      period: filters.period,
      month: filters.month,
      from: filters.from,
      to: filters.to,
      categoryId: filters.categoryId,
      scope: filters.scope,
      costType: filters.costType,
      recurrence: filters.recurrence,
      currency: filters.currency,
      ...(params.page ? { page: params.page } : {}),
    }, today),
    getExpenseFormOptions({ includeInactive: true }),
    getRecurringExpenses(),
  ]);

  return <main className="expenses-page">
    <header className="page-heading page-heading--actions"><div><p className="eyebrow">Libro de obligaciones</p><h1>Gastos</h1><p>Detectá qué vence y resolvelo sin perder contexto.</p></div><Link className="primary-button" href="/expenses/new"><Plus size={17} /> Nuevo gasto</Link></header>
    <ExpenseFilters params={filters} categories={options.categories.map((category) => ({ id: category.id, label: category.name }))} />
    <div className="client-result-count" aria-live="polite">{page.pagination.total} {page.pagination.total === 1 ? "gasto" : "gastos"}</div>
    <ExpenseTable expenses={page.items} today={today} />
    {page.pagination.totalPages > 1 ? <nav className="expense-pagination" aria-label="Páginas de gastos">
      {page.pagination.page > 1 ? <Link className="quiet-button" href={paginationHref(params, page.pagination.page - 1)} aria-label="Página anterior">Anterior</Link> : <span aria-disabled="true">Anterior</span>}
      <span>Página {page.pagination.page} de {page.pagination.totalPages}</span>
      {page.pagination.page < page.pagination.totalPages ? <Link className="quiet-button" href={paginationHref(params, page.pagination.page + 1)} aria-label="Página siguiente">Siguiente</Link> : <span aria-disabled="true">Siguiente</span>}
    </nav> : null}
    <section className="recurring-expense-sheet" aria-labelledby="recurring-expenses-title">
      <header><div><span><CalendarClock size={17} /></span><div><h2 id="recurring-expenses-title">Compromisos recurrentes</h2><p>Cadencia, próxima fecha y estado de las obligaciones que se repiten.</p></div></div><Link className="secondary-button" href="/expenses/recurring">Administrar</Link></header>
      <RecurringExpenseList recurringExpenses={recurringExpenses} today={today} />
    </section>
  </main>;
}
