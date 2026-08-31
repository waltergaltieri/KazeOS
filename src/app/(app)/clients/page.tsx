import { Search, UserPlus } from "lucide-react";
import Link from "next/link";

import { ClientList } from "@/components/clients/client-list";
import { getClients } from "@/lib/queries/clients";
import type { ClientFilter } from "@/lib/validations/client";

const filters: { value: ClientFilter; label: string }[] = [
  { value: "all", label: "Cartera" },
  { value: "active", label: "Activos" },
  { value: "paused", label: "En pausa" },
  { value: "debt", label: "Con deuda" },
  { value: "current", label: "Al día" },
  { value: "archived", label: "Archivados" },
];

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ q?: string; filter?: string }> }) {
  const params = await searchParams;
  const activeFilter = filters.some(({ value }) => value === params.filter)
    ? (params.filter as ClientFilter)
    : "all";
  const hasActiveFilters = Boolean(params.q?.trim()) || activeFilter !== "all";
  const items = await getClients({ search: params.q, filter: activeFilter });

  return (
    <main className="clients-page">
      <header className="page-heading page-heading--actions">
        <div><p className="eyebrow">Cartera comercial</p><h1>Clientes</h1><p>Legajos, contactos y saldos en una sola vista.</p></div>
        <Link className="primary-button" href="/clients/new"><UserPlus size={17} aria-hidden="true" /> Nuevo cliente</Link>
      </header>

      <section className="client-toolbar" aria-label="Buscar y filtrar clientes">
        <form className="client-search" role="search">
          <Search size={17} aria-hidden="true" />
          <label className="sr-only" htmlFor="client-search">Buscar clientes</label>
          <input id="client-search" name="q" type="search" defaultValue={params.q ?? ""} placeholder="Nombre, empresa o email" />
          <input type="hidden" name="filter" value={activeFilter} />
          <button type="submit" className="quiet-button">Buscar</button>
        </form>
        <nav className="filter-tabs" aria-label="Filtrar clientes">
          {filters.map(({ value, label }) => {
            const query = new URLSearchParams();
            if (params.q) query.set("q", params.q);
            if (value !== "all") query.set("filter", value);
            const href = query.size ? `/clients?${query}` : "/clients";
            return <Link key={value} href={href} aria-current={activeFilter === value ? "page" : undefined}>{label}</Link>;
          })}
        </nav>
      </section>

      <div className="client-result-count" aria-live="polite">{items.length} {items.length === 1 ? "legajo" : "legajos"}</div>
      <ClientList clients={items} hasActiveFilters={hasActiveFilters} />
    </main>
  );
}
