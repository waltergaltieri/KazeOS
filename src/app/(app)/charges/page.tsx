import { Plus } from "lucide-react";
import Link from "next/link";
import { ChargeFilters } from "@/components/charges/charge-filters";
import { ChargeTable } from "@/components/charges/charge-table";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";
import { getChargeFilterOptions, getCharges } from "@/lib/queries/charges";

const filters = [{ value: "all", label: "Todos" }, { value: "current_month", label: "Este mes" }, { value: "upcoming", label: "Próximos" }, { value: "due_today", label: "Vencen hoy" }, { value: "overdue", label: "Vencidos" }, { value: "partial", label: "Parciales" }, { value: "paid", label: "Cobrados" }] as const;
export default async function ChargesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams; const today = todayInBusinessZone(new Date()); const status = filters.some((item) => item.value === params.status) ? params.status! : "all";
  const [items, options] = await Promise.all([getCharges({ status, search: params.q, currency: params.currency, clientId: params.clientId, serviceId: params.serviceId, from: params.from, to: params.to }, today), getChargeFilterOptions()]);
  return <main className="charges-page"><header className="page-heading page-heading--actions"><div><p className="eyebrow">Libro de cuentas por cobrar</p><h1>Cobros</h1><p>Encontrá lo urgente y registrá el movimiento sin perder el hilo.</p></div><Link className="primary-button" href="/charges/new"><Plus size={17} /> Nuevo cobro</Link></header>
    <ChargeFilters params={{ ...params, status }} clients={options.clients} services={options.services} />
    <div className="client-result-count" aria-live="polite">{items.length} {items.length === 1 ? "cobro" : "cobros"}</div><ChargeTable charges={items} today={today} /></main>;
}
