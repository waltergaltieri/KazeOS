"use client";

import { ArrowRight, CircleDollarSign } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ChargeStatusBadge } from "@/components/charges/charge-status-badge";
import { PaymentDialog } from "@/components/payments/payment-dialog";
import { formatAggregateMoney } from "@/lib/domain/money";
import type { DashboardCharge } from "@/lib/queries/dashboard";

function formatDate(date: string) { return date.split("-").reverse().join("/"); }

export function UpcomingCharges({ charges, today }: { charges: DashboardCharge[]; today: string }) {
  const [paying, setPaying] = useState<DashboardCharge | null>(null);
  return (
    <section className="dashboard-panel dashboard-upcoming-charges" aria-labelledby="upcoming-charges-title">
      <header className="dashboard-panel__heading"><div><p className="eyebrow">Prioridad financiera</p><h2 id="upcoming-charges-title">Próximos cobros</h2></div><Link href="/charges">Ver todos <ArrowRight size={14} /></Link></header>
      {charges.length ? (
        <div className="dashboard-charge-list">
          {charges.map((charge) => (
            <article className="dashboard-charge-row" data-testid="upcoming-charge" key={charge.id}>
              <div><strong>{charge.clientName}</strong><span>{charge.description}</span></div>
              <time dateTime={charge.dueDate}>{formatDate(charge.dueDate)}</time>
              <ChargeStatusBadge status={charge.status} />
              <strong className="money-data">{formatAggregateMoney(charge.outstandingMinor, charge.currency)}</strong>
              <button className="quiet-button" type="button" aria-label={`Registrar pago de ${charge.description}`} onClick={() => setPaying(charge)}>Cobrar</button>
            </article>
          ))}
        </div>
      ) : (
        <div className="dashboard-module-empty"><span aria-hidden="true"><CircleDollarSign size={19} /></span><div><strong>Sin cobros pendientes</strong><p>Creá una obligación para empezar a ordenar el flujo.</p></div><Link className="secondary-button" href="/charges/new">Crear primer cobro</Link></div>
      )}
      {paying ? <PaymentDialog charge={paying} today={today} open onClose={() => setPaying(null)} /> : null}
    </section>
  );
}
