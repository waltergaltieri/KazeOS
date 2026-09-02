import { ArrowRight, FolderOpen, UserPlus } from "lucide-react";
import Link from "next/link";

import { formatAggregateMoney } from "@/lib/domain/money";
import type { ClientListItem } from "@/lib/queries/clients";

const statusLabel = {
  active: "Activo",
  paused: "En pausa",
  archived: "Archivado",
} as const;

function contactName(client: ClientListItem) {
  return [client.firstName, client.lastName].filter(Boolean).join(" ");
}

function primaryName(client: ClientListItem) {
  return client.company || contactName(client);
}

function secondaryName(client: ClientListItem) {
  return client.company ? contactName(client) : "Cliente particular";
}

function Balance({ client }: { client: ClientListItem }) {
  const hasDebt = client.outstanding.USD !== "0" || client.outstanding.ARS !== "0";
  if (!hasDebt) return <span className="balance-current">Al día</span>;

  return (
    <span className="currency-stack" aria-label="Saldo pendiente">
      {client.outstanding.USD !== "0" ? (
        <span>{formatAggregateMoney(client.outstanding.USD, "USD")}</span>
      ) : null}
      {client.outstanding.ARS !== "0" ? (
        <span>{formatAggregateMoney(client.outstanding.ARS, "ARS")}</span>
      ) : null}
    </span>
  );
}

export function ClientList({
  clients: items,
  hasActiveFilters = false,
}: {
  clients: ClientListItem[];
  hasActiveFilters?: boolean;
}) {
  if (items.length === 0) {
    if (hasActiveFilters) {
      return (
        <section className="client-empty" aria-labelledby="empty-client-title">
          <span className="client-empty__mark" aria-hidden="true">
            <FolderOpen size={24} />
          </span>
          <div>
            <p className="eyebrow">Sin coincidencias</p>
            <h2 id="empty-client-title">No encontramos clientes</h2>
            <p>No hay legajos que coincidan con la búsqueda o los filtros aplicados.</p>
          </div>
          <Link className="secondary-button" href="/clients">
            Limpiar búsqueda y filtros
          </Link>
        </section>
      );
    }

    return (
      <section className="client-empty" aria-labelledby="empty-client-title">
        <span className="client-empty__mark" aria-hidden="true">
          <FolderOpen size={24} />
        </span>
        <div>
          <p className="eyebrow">Cartera vacía</p>
          <h2 id="empty-client-title">Todavía no hay clientes</h2>
          <p>Creá el primer legajo para empezar a ordenar contactos y saldos.</p>
        </div>
        <Link className="primary-button" href="/clients/new">
          <UserPlus size={17} aria-hidden="true" /> Crear primer cliente
        </Link>
      </section>
    );
  }

  return (
    <section className="client-ledger" aria-label="Listado de clientes">
      <div className="client-table-wrap">
        <table className="client-table">
          <thead>
            <tr>
              <th scope="col">Cliente</th>
              <th scope="col">Contacto</th>
              <th scope="col">Estado</th>
              <th scope="col" className="align-end">Saldo</th>
              <th scope="col"><span className="sr-only">Abrir</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((client) => (
              <tr key={client.id}>
                <td>
                  <Link className="client-name-link" href={`/clients/${client.id}`}>
                    {primaryName(client)}
                  </Link>
                  <span className="client-company">
                    {secondaryName(client)}
                  </span>
                </td>
                <td>
                  <span className="client-contact">{client.email || client.phone || "Sin contacto"}</span>
                </td>
                <td><span className={`status-pill status-pill--${client.status}`}>{statusLabel[client.status]}</span></td>
                <td className="align-end"><Balance client={client} /></td>
                <td className="client-open-cell">
                  <Link href={`/clients/${client.id}`} aria-label={`Abrir legajo de ${primaryName(client)}`}>
                    <ArrowRight size={17} aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="client-card-list">
        {items.map((client) => (
          <article className="client-card" key={client.id}>
            <span className="client-card__rail" aria-hidden="true" />
            <div className="client-card__heading">
              <div>
                <Link className="client-name-link" href={`/clients/${client.id}`}>
                  {primaryName(client)}
                </Link>
                <span className="client-company">{secondaryName(client)}</span>
              </div>
              <span className={`status-pill status-pill--${client.status}`}>{statusLabel[client.status]}</span>
            </div>
            <div className="client-card__facts">
              <span>{client.email || client.phone || "Sin contacto"}</span>
              <Balance client={client} />
            </div>
            <Link className="client-card__open" href={`/clients/${client.id}`} aria-label={`Abrir legajo de ${primaryName(client)}`}>
              Abrir legajo <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
