import { CalendarPlus, CheckSquare2, CircleDollarSign, Receipt } from "lucide-react";
import Link from "next/link";

import { formatAggregateMoney } from "@/lib/domain/money";
import type { DashboardMovement } from "@/lib/queries/dashboard";

function formatDate(date: string | null) { return date ? date.split("-").reverse().join("/") : "Sin fecha"; }

export function UpcomingMovements({ movements }: { movements: DashboardMovement[] }) {
  return (
    <section className="dashboard-panel dashboard-movements" aria-labelledby="movements-title">
      <header className="dashboard-panel__heading"><div><p className="eyebrow">Bitácora comercial</p><h2 id="movements-title">Próximos movimientos</h2></div></header>
      {movements.length ? (
        <ol className="dashboard-movement-rail" aria-label="Próximos movimientos">
          {movements.map((movement) => <li className={movement.isOverdue ? "is-overdue" : undefined} key={`${movement.kind}-${movement.id}`}><span className={`dashboard-movement-mark dashboard-movement-mark--${movement.kind}`} aria-hidden="true">{movement.kind === "charge" ? <CircleDollarSign size={15} /> : movement.kind === "expense" ? <Receipt size={15} /> : <CheckSquare2 size={15} />}</span><div><strong>{movement.label}</strong><span>{movement.context ?? (movement.kind === "task" ? "Tarea general" : movement.kind === "expense" ? "Gasto" : "Cobro")}</span></div><div><time dateTime={movement.date ?? undefined}>{formatDate(movement.date)}</time>{movement.amountMinor && movement.currency ? <strong>{formatAggregateMoney(movement.amountMinor, movement.currency)}</strong> : movement.priority ? <span className={`dashboard-priority dashboard-priority--${movement.priority}`}>{movement.priority === "high" ? "Alta" : movement.priority === "medium" ? "Media" : "Baja"}</span> : null}</div></li>)}
        </ol>
      ) : (
        <div className="dashboard-module-empty"><span aria-hidden="true"><CalendarPlus size={19} /></span><div><strong>Sin movimientos próximos</strong><p>Un cobro, gasto o tarea activa va a aparecer en esta cronología.</p></div><Link className="secondary-button" href="/charges/new">Agregar movimiento</Link></div>
      )}
    </section>
  );
}
