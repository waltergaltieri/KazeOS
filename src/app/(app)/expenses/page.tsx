import { CalendarClock, Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ExpenseFilters, type ExpenseFilterParams } from "@/components/expenses/expense-filters";
import { ExpenseTable } from "@/components/expenses/expense-table";
import { RecurringExpenseList } from "@/components/expenses/recurring-expense-list";
import { todayInBusinessZone, validateCommercialDate } from "@/lib/domain/commercial-date";
import { getExpenseFormOptions, getExpenses, getRecurringExpenses } from "@/lib/queries/expenses";

type RawSearchParams = Record<string, string | string[] | undefined>;
interface SanitizedSearchParams extends ExpenseFilterParams {
  page?: string;
  [key: string]: string | undefined;
}

const allowedStatus = ["all", "planned", "pending", "overdue", "paid", "cancelled"] as const;
const allowedPeriod = ["current_month", "next_month", "custom", "all"] as const;
const allowedScope = ["business", "personal", "family", "friends", "partner", "other"] as const;
const allowedCostType = ["fixed", "variable"] as const;
const allowedRecurrence = ["all", "one_off", "recurring"] as const;
const allowedCurrency = ["USD", "ARS"] as const;

function scalar(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function oneOf<const T extends readonly string[]>(value: string | string[] | undefined, allowed: T): T[number] | undefined {
  const candidate = scalar(value);
  return candidate && allowed.includes(candidate) ? candidate as T[number] : undefined;
}

function commercialDate(value: string | string[] | undefined) {
  const candidate = scalar(value);
  if (!candidate) return undefined;
  try {
    return validateCommercialDate(candidate);
  } catch {
    return undefined;
  }
}

function sanitizeSearchParams(raw: RawSearchParams): SanitizedSearchParams {
  const search = scalar(raw.q)?.trim();
  const month = scalar(raw.month);
  let period = oneOf(raw.period, allowedPeriod);
  let from = commercialDate(raw.from);
  let to = commercialDate(raw.to);
  if (from && to && from > to) {
    from = undefined;
    to = undefined;
  }
  if (period === "custom" && (!from || !to)) {
    period = undefined;
    from = undefined;
    to = undefined;
  }
  const rawPage = scalar(raw.page);
  const page = rawPage && /^[1-9]\d*$/.test(rawPage) && Number(rawPage) <= 10_000
    ? rawPage
    : undefined;

  return {
    q: search && search.length <= 160 ? search : undefined,
    status: oneOf(raw.status, allowedStatus),
    period,
    month: month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : undefined,
    from,
    to,
    categoryId: /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(scalar(raw.categoryId) ?? "") ? scalar(raw.categoryId) : undefined,
    scope: oneOf(raw.scope, allowedScope),
    costType: oneOf(raw.costType, allowedCostType),
    recurrence: oneOf(raw.recurrence, allowedRecurrence),
    currency: oneOf(raw.currency, allowedCurrency),
    page,
  };
}

function paginationHref(params: Record<string, string | undefined>, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== "page" && value) query.set(key, value);
  }
  query.set("page", String(page));
  return `/expenses?${query}`;
}

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const params = sanitizeSearchParams(await searchParams);
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
  if (params.page && page.pagination.totalPages > 0 && page.pagination.page > page.pagination.totalPages) {
    redirect(paginationHref(params, page.pagination.totalPages));
  }

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
