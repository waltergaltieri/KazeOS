"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { LedgerSelect } from "@/components/ui/ledger-select";

export interface ExpenseFilterParams {
  q?: string;
  status?: string;
  period?: string;
  month?: string;
  from?: string;
  to?: string;
  categoryId?: string;
  scope?: string;
  costType?: string;
  recurrence?: string;
  currency?: string;
}

interface FilterOption { id: string; label: string }

const statuses = [
  { value: "all", label: "Todos" },
  { value: "planned", label: "Planificados" },
  { value: "pending", label: "Pendientes" },
  { value: "overdue", label: "Vencidos" },
  { value: "paid", label: "Pagados" },
  { value: "cancelled", label: "Cancelados" },
] as const;

const periodOptions = [
  { value: "current_month", label: "Este mes" },
  { value: "next_month", label: "Próximo mes" },
  { value: "all", label: "Todo el historial" },
  { value: "custom", label: "Personalizado" },
] as const;
const periodTabs = periodOptions.filter((item) => item.value !== "custom");

const queryOrder: (keyof ExpenseFilterParams)[] = [
  "q", "status", "period", "month", "from", "to", "categoryId", "scope", "costType", "recurrence", "currency",
];

function queryWith(
  params: ExpenseFilterParams,
  changes: Partial<ExpenseFilterParams>,
) {
  const next = { ...params, ...changes };
  if (changes.period && changes.period !== "custom") {
    delete next.from;
    delete next.to;
  }
  const query = new URLSearchParams();
  for (const key of queryOrder) {
    const value = next[key];
    if (!value) continue;
    if (key === "status" && value === "all") continue;
    query.set(key, value);
  }
  return query.size ? `/expenses?${query}` : "/expenses";
}

function HiddenScope({ params, omit = [] }: { params: ExpenseFilterParams; omit?: (keyof ExpenseFilterParams)[] }) {
  return <>{queryOrder.filter((key) => !omit.includes(key)).map((key) => (
    <input key={key} type="hidden" name={key} value={params[key] ?? ""} />
  ))}</>;
}

export function ExpenseFilters({
  params,
  categories,
}: {
  params: ExpenseFilterParams;
  categories: FilterOption[];
}) {
  const status = statuses.some((item) => item.value === params.status) ? params.status! : "all";
  const period = periodOptions.some((item) => item.value === params.period) ? params.period! : "current_month";
  const [selectedPeriod, setSelectedPeriod] = useState(period);
  const normalized = { ...params, period, status };
  const advanced = Boolean(
    params.categoryId || params.scope || params.costType || params.recurrence && params.recurrence !== "all" || params.currency || period === "custom",
  );

  return (
    <section className="expense-toolbar" aria-label="Buscar y filtrar gastos">
      <form className="client-search expense-search" role="search">
        <Search size={17} aria-hidden="true" />
        <label className="sr-only" htmlFor="expense-search">Buscar gastos</label>
        <input id="expense-search" name="q" type="search" defaultValue={params.q ?? ""} placeholder="Gasto, proveedor o nota" />
        <HiddenScope params={normalized} omit={["q"]} />
        <button className="quiet-button">Buscar</button>
      </form>

      <div className="expense-filter-rails">
        <nav className="filter-tabs" aria-label="Filtrar gastos por estado">
          {statuses.map((item) => <Link key={item.value} href={queryWith(normalized, { status: item.value })} aria-current={status === item.value ? "page" : undefined}>{item.label}</Link>)}
        </nav>
        <nav className="expense-period-tabs" aria-label="Filtrar gastos por período">
          {periodTabs.map((item) => <Link key={item.value} href={queryWith(normalized, { period: item.value })} aria-current={period === item.value ? "page" : undefined}>{item.label}</Link>)}
        </nav>
      </div>

      <details className="expense-advanced" open={advanced}>
        <summary>Categoría, clasificación, recurrencia y moneda</summary>
        <form className="expense-filter-fields">
          <input type="hidden" name="q" value={params.q ?? ""} />
          <input type="hidden" name="status" value={status} />
          <label><span>Período</span><LedgerSelect name="period" label="Período" defaultValue={period} options={periodOptions.map((item) => ({ value: item.value, label: item.label }))} onValueChange={setSelectedPeriod} /></label>
          <label><span>Mes de referencia</span><input className="form-control" name="month" inputMode="numeric" placeholder="AAAA-MM" defaultValue={params.month ?? ""} /></label>
          <label><span>Categoría</span><LedgerSelect name="categoryId" label="Categoría" defaultValue={params.categoryId ?? ""} options={[{ value: "", label: "Todas" }, ...categories.map((item) => ({ value: item.id, label: item.label }))]} /></label>
          <label><span>Ámbito</span><LedgerSelect name="scope" label="Ámbito" defaultValue={params.scope ?? ""} options={[{ value: "", label: "Todos" }, { value: "business", label: "Negocio" }, { value: "personal", label: "Personal" }, { value: "family", label: "Familia" }, { value: "friends", label: "Amigos" }, { value: "partner", label: "Pareja" }, { value: "other", label: "Otro" }]} /></label>
          <label><span>Tipo</span><LedgerSelect name="costType" label="Tipo" defaultValue={params.costType ?? ""} options={[{ value: "", label: "Todos" }, { value: "fixed", label: "Fijo" }, { value: "variable", label: "Variable" }]} /></label>
          <label><span>Recurrencia</span><LedgerSelect name="recurrence" label="Recurrencia" defaultValue={params.recurrence ?? "all"} options={[{ value: "all", label: "Todos" }, { value: "one_off", label: "Únicos" }, { value: "recurring", label: "Recurrentes" }]} /></label>
          <label><span>Moneda</span><LedgerSelect name="currency" label="Moneda" defaultValue={params.currency ?? ""} options={[{ value: "", label: "Todas" }, { value: "USD", label: "USD" }, { value: "ARS", label: "ARS" }]} /></label>
          <label><span>Desde</span><input className="form-control" name="from" inputMode="numeric" placeholder="AAAA-MM-DD" defaultValue={params.from ?? ""} required={selectedPeriod === "custom"} /></label>
          <label><span>Hasta</span><input className="form-control" name="to" inputMode="numeric" placeholder="AAAA-MM-DD" defaultValue={params.to ?? ""} required={selectedPeriod === "custom"} /></label>
          <div className="expense-filter-actions">
            <Link className="quiet-button" href="/expenses">Limpiar filtros</Link>
            <button className="secondary-button">Aplicar filtros</button>
          </div>
        </form>
      </details>
    </section>
  );
}
