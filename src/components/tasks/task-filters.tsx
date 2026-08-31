import { Search } from "lucide-react";
import Link from "next/link";

import { LedgerSelect } from "@/components/ui/ledger-select";
import type { TaskFilters as ParsedTaskFilters } from "@/lib/validations/task";

type TaskFilterParams = Partial<ParsedTaskFilters> & { q?: string };

const statuses = [
  { value: "all", label: "Todas" },
  { value: "today", label: "Hoy" },
  { value: "upcoming", label: "Próximas" },
  { value: "overdue", label: "Vencidas" },
  { value: "undated", label: "Sin fecha" },
  { value: "completed", label: "Completadas" },
] as const;

function hrefFor(basePath: string, params: TaskFilterParams, status: string) {
  const search = new URLSearchParams();
  const q = params.search ?? params.q;
  if (q) search.set("q", q);
  search.set("status", status);
  if (params.clientId) search.set("clientId", params.clientId);
  if (params.priority) search.set("priority", params.priority);
  return `${basePath}?${search.toString()}`;
}

export function TaskFilters({
  basePath,
  clients,
  params,
  fixedClientId,
}: {
  basePath: string;
  clients: { id: string; label: string }[];
  params: TaskFilterParams;
  fixedClientId?: string;
}) {
  const status = params.status ?? "all";
  const q = params.search ?? params.q ?? "";
  const filtersOpen = Boolean(params.priority || (!fixedClientId && params.clientId));

  return (
    <section className="task-toolbar" aria-label="Buscar y filtrar tareas">
      <form className="client-search" role="search">
        <Search size={17} aria-hidden="true" />
        <label className="sr-only" htmlFor="task-search">Buscar tareas</label>
        <input id="task-search" name="q" type="search" defaultValue={q} placeholder="Tarea o cliente" />
        <input type="hidden" name="status" value={status} />
        <input type="hidden" name="clientId" value={fixedClientId ?? params.clientId ?? ""} />
        <input type="hidden" name="priority" value={params.priority ?? ""} />
        <button className="quiet-button">Buscar</button>
      </form>
      <nav className="filter-tabs" aria-label="Filtrar tareas">
        {statuses.map((filter) => (
          <Link key={filter.value} href={hrefFor(basePath, { ...params, clientId: fixedClientId ?? params.clientId }, filter.value)} aria-current={status === filter.value ? "page" : undefined}>
            {filter.label}
          </Link>
        ))}
      </nav>
      <details className="task-advanced" open={filtersOpen}>
        <summary>Cliente y prioridad</summary>
        <form className="task-filter-fields">
          <input type="hidden" name="q" value={q} />
          <input type="hidden" name="status" value={status} />
          {fixedClientId ? <input type="hidden" name="clientId" value={fixedClientId} /> : (
            <label><span>Cliente</span><LedgerSelect name="clientId" label="Cliente del filtro" defaultValue={params.clientId ?? ""} options={[{ value: "", label: "Todos" }, ...clients.map((client) => ({ value: client.id, label: client.label }))]} /></label>
          )}
          <label><span>Prioridad</span><LedgerSelect name="priority" label="Prioridad del filtro" defaultValue={params.priority ?? ""} options={[{ value: "", label: "Todas" }, { value: "high", label: "Alta" }, { value: "medium", label: "Media" }, { value: "low", label: "Baja" }]} /></label>
          <div className="task-filter-actions">
            <Link className="quiet-button" href={basePath}>Limpiar filtros</Link>
            <button className="secondary-button">Aplicar filtros</button>
          </div>
        </form>
      </details>
    </section>
  );
}
