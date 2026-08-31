import { CircleCheck, CircleDollarSign, Clock3 } from "lucide-react";

export default function DashboardPage() {
  return (
    <section className="dashboard-entry" aria-labelledby="dashboard-title">
      <header className="dashboard-entry__heading">
        <p className="eyebrow">Agenda operativa</p>
        <h1 id="dashboard-title">Resumen diario</h1>
        <p>Cobros, obligaciones y tareas en un único recorrido.</p>
      </header>

      <div className="empty-ledger">
        <div className="empty-ledger__rail" aria-hidden="true">
          <span className="is-collected"><CircleCheck size={17} /></span>
          <span className="is-reminder"><Clock3 size={17} /></span>
          <span><CircleDollarSign size={17} /></span>
        </div>
        <div>
          <p className="empty-ledger__label">Espacio listo</p>
          <h2>Tu información va a tomar forma acá.</h2>
          <p>
            El resumen mostrará movimientos reales cuando estén disponibles,
            sin inventar información para completar la vista.
          </p>
        </div>
      </div>
    </section>
  );
}
