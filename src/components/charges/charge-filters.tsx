import { Search } from "lucide-react";
import Link from "next/link";

import { LedgerSelect } from "@/components/ui/ledger-select";

export interface ChargeFilterParams {
  q?: string;
  status?: string;
  clientId?: string;
  serviceId?: string;
  currency?: string;
  from?: string;
  to?: string;
}

interface FilterOption { id: string; label: string }

const statuses = [{ value: "all", label: "Todos" }, { value: "current_month", label: "Este mes" }, { value: "upcoming", label: "Próximos" }, { value: "due_today", label: "Vencen hoy" }, { value: "overdue", label: "Vencidos" }, { value: "partial", label: "Parciales" }, { value: "paid", label: "Cobrados" }] as const;

function queryWith(params: ChargeFilterParams, status: string) {
  const query = new URLSearchParams();
  if (params.q) query.set("q", params.q);
  if (status !== "all") query.set("status", status);
  if (params.clientId) query.set("clientId", params.clientId);
  if (params.serviceId) query.set("serviceId", params.serviceId);
  if (params.currency) query.set("currency", params.currency);
  if (params.from) query.set("from", params.from);
  if (params.to) query.set("to", params.to);
  return query.size ? `/charges?${query}` : "/charges";
}

export function ChargeFilters({ params, clients, services }: { params: ChargeFilterParams; clients: FilterOption[]; services: FilterOption[] }) {
  const status = statuses.some((item) => item.value === params.status) ? params.status! : "all";
  const advanced = Boolean(params.clientId || params.serviceId || params.currency || params.from || params.to);

  return <section className="charge-toolbar" aria-label="Buscar y filtrar cobros"><form className="client-search" role="search"><Search size={17} /><label className="sr-only" htmlFor="charge-search">Buscar cobros</label><input id="charge-search" name="q" type="search" defaultValue={params.q ?? ""} placeholder="Cliente o concepto" /><input type="hidden" name="status" value={status} /><input type="hidden" name="clientId" value={params.clientId ?? ""} /><input type="hidden" name="serviceId" value={params.serviceId ?? ""} /><input type="hidden" name="currency" value={params.currency ?? ""} /><input type="hidden" name="from" value={params.from ?? ""} /><input type="hidden" name="to" value={params.to ?? ""} /><button className="quiet-button">Buscar</button></form><nav className="filter-tabs" aria-label="Filtrar cobros">{statuses.map((filter) => <Link key={filter.value} href={queryWith(params, filter.value)} aria-current={status === filter.value ? "page" : undefined}>{filter.label}</Link>)}</nav><details className="charge-advanced" open={advanced}><summary>Cliente, servicio, moneda y período</summary><form><input type="hidden" name="q" value={params.q ?? ""} /><input type="hidden" name="status" value={status} /><label><span>Cliente</span><LedgerSelect name="clientId" label="Cliente del filtro" defaultValue={params.clientId ?? ""} options={[{ value: "", label: "Todos" }, ...clients.map((client) => ({ value: client.id, label: client.label }))]} /></label><label><span>Servicio</span><LedgerSelect name="serviceId" label="Servicio del filtro" defaultValue={params.serviceId ?? ""} options={[{ value: "", label: "Todos" }, ...services.map((service) => ({ value: service.id, label: service.label }))]} /></label><label><span>Moneda</span><LedgerSelect name="currency" label="Moneda del filtro" defaultValue={params.currency ?? ""} options={[{ value: "", label: "Todas" }, { value: "USD", label: "USD" }, { value: "ARS", label: "ARS" }]} /></label><label><span>Desde</span><input className="form-control" name="from" inputMode="numeric" placeholder="AAAA-MM-DD" defaultValue={params.from ?? ""} /></label><label><span>Hasta</span><input className="form-control" name="to" inputMode="numeric" placeholder="AAAA-MM-DD" defaultValue={params.to ?? ""} /></label><div className="charge-filter-actions"><Link className="quiet-button" href="/charges">Limpiar filtros</Link><button className="secondary-button">Aplicar filtros</button></div></form></details></section>;
}
