import { CalendarClock, Plus, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ExpenseBreakdowns } from "@/components/expenses/expense-breakdowns";
import { ExpenseFilters, type ExpenseFilterParams } from "@/components/expenses/expense-filters";
import { ExpenseSummary } from "@/components/expenses/expense-summary";
import { ExpenseTable } from "@/components/expenses/expense-table";
import { RecurringExpenseList } from "@/components/expenses/recurring-expense-list";
import { UpcomingExpenses } from "@/components/expenses/upcoming-expenses";
import { addCommercialPeriod, todayInBusinessZone, validateCommercialDate } from "@/lib/domain/commercial-date";
import type { Currency } from "@/lib/domain/money";
import { getExpensePageData } from "@/lib/queries/expense-page";
import type { ExpensePeriod, ExpenseQueryInput } from "@/lib/queries/expenses";

type RawSearchParams = Record<string, string | string[] | undefined>;
interface SanitizedSearchParams extends ExpenseFilterParams {
  status?: typeof allowedStatus[number];
  period?: typeof allowedPeriod[number];
  scope?: typeof allowedScope[number];
  costType?: typeof allowedCostType[number];
  recurrence?: typeof allowedRecurrence[number];
  currency?: Currency;
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

function nextCommercialDate(value: string) {
  const [year, month, day] = validateCommercialDate(value).split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}

function insightPeriod(params: SanitizedSearchParams, today: string): ExpensePeriod {
  if (params.period === "custom" && params.from && params.to) {
    return { start: params.from, end: nextCommercialDate(params.to) };
  }
  if (params.period === "all") {
    return { start: "0001-01-01", end: "9999-12-31" };
  }
  const base = `${params.month ?? today.slice(0, 7)}-01`;
  const start = params.period === "next_month" ? addCommercialPeriod(base, "monthly") : base;
  return { start, end: addCommercialPeriod(start, "monthly") };
}

function currencyHref(params: SanitizedSearchParams, currency: Currency) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== "page" && key !== "currency" && value) query.set(key, value);
  }
  query.set("currency", currency);
  return `/expenses?${query}`;
}

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const params = sanitizeSearchParams(await searchParams);
  const today = todayInBusinessZone(new Date());
  const selectedCurrency: Currency = params.currency ?? "USD";
  const period = insightPeriod(params, today);
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
    currency: selectedCurrency,
  };
  const expenseQuery: ExpenseQueryInput = {
    search: params.q,
    status: params.status ?? "all",
    period: params.period ?? "current_month",
    month: params.month,
    from: params.from,
    to: params.to,
    categoryId: params.categoryId,
    scope: params.scope,
    costType: params.costType,
    recurrence: params.recurrence ?? "all",
    currency: selectedCurrency,
    ...(params.page ? { page: params.page } : {}),
  };
  const {
    page,
    options,
    recurringExpenses,
    insights,
  } = await getExpensePageData({
    currency: selectedCurrency,
    expenseQuery,
    period,
    today,
  });
  if (params.page && page.pagination.totalPages > 0 && page.pagination.page > page.pagination.totalPages) {
    redirect(paginationHref(params, page.pagination.totalPages));
  }

  return <main className="expenses-page">
    <header className="page-heading page-heading--actions"><div><p className="eyebrow">Libro de obligaciones</p><h1>Gastos</h1><p>Detectá qué vence y resolvelo sin perder contexto.</p></div><div className="expense-heading-actions"><nav className="expense-currency-switch" aria-label="Moneda de lectura">{(["USD", "ARS"] as const).map((currency) => <Link key={currency} href={currencyHref(params, currency)} aria-current={selectedCurrency === currency ? "page" : undefined}>{currency}</Link>)}</nav><Link className="primary-button" href="/expenses/new"><Plus size={17} /> Nuevo gasto</Link></div></header>
    {insights.status === "unavailable" ? <div className="expense-insight-warning" role="status" aria-live="polite"><TriangleAlert aria-hidden="true" size={18} /><p><strong>El análisis no está disponible.</strong> El libro y sus acciones siguen operativos.</p></div> : null}
    {insights.status === "available" ? <ExpenseSummary summary={insights.summary} cashFlow={insights.cashFlow} currency={selectedCurrency} /> : <ExpenseSummary currency={selectedCurrency} unavailable />}
    <ExpenseFilters params={filters} categories={options.categories.map((category) => ({ id: category.id, label: category.name }))} />
    <div className="client-result-count" aria-live="polite">{page.pagination.total} {page.pagination.total === 1 ? "gasto" : "gastos"}</div>
    <ExpenseTable expenses={page.items} today={today} />
    {page.pagination.totalPages > 1 ? <nav className="expense-pagination" aria-label="Páginas de gastos">
      {page.pagination.page > 1 ? <Link className="quiet-button" href={paginationHref(params, page.pagination.page - 1)} aria-label="Página anterior">Anterior</Link> : <span aria-disabled="true">Anterior</span>}
      <span>Página {page.pagination.page} de {page.pagination.totalPages}</span>
      {page.pagination.page < page.pagination.totalPages ? <Link className="quiet-button" href={paginationHref(params, page.pagination.page + 1)} aria-label="Página siguiente">Siguiente</Link> : <span aria-disabled="true">Siguiente</span>}
    </nav> : null}
    <div className="expense-insight-grid">
      {insights.status === "available" ? <ExpenseBreakdowns byCategory={insights.byCategory} byScope={insights.byScope} byCostType={insights.byCostType} currency={selectedCurrency} /> : <ExpenseBreakdowns currency={selectedCurrency} unavailable />}
      {insights.status === "available" ? <UpcomingExpenses expenses={insights.upcomingExpenses} today={today} currency={selectedCurrency} /> : <UpcomingExpenses today={today} currency={selectedCurrency} unavailable />}
    </div>
    <section className="recurring-expense-sheet" aria-labelledby="recurring-expenses-title">
      <header><div><span><CalendarClock size={17} /></span><div><h2 id="recurring-expenses-title">Compromisos recurrentes</h2><p>Cadencia, próxima fecha y estado de las obligaciones que se repiten.</p></div></div><Link className="secondary-button" href="/expenses/recurring">Administrar</Link></header>
      <RecurringExpenseList recurringExpenses={recurringExpenses} today={today} />
    </section>
  </main>;
}
