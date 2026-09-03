import { CalendarClock, ChartNoAxesCombined, CircleDollarSign, Clock3, Receipt, Scale, TriangleAlert, Users } from "lucide-react";
import Link from "next/link";

import { formatAggregateMoney } from "@/lib/domain/money";
import type { DashboardMetrics } from "@/lib/queries/dashboard";

const financialCards = [
  { key: "collectedThisMonth", label: "Cobrado este mes", note: "Pagos registrados", icon: CircleDollarSign, tone: "collected" },
  { key: "pending", label: "Pendiente", note: "Este mes calendario", icon: Clock3, tone: "pending" },
  { key: "overdue", label: "Vencido", note: "Saldo fuera de término", icon: TriangleAlert, tone: "overdue" },
  { key: "mrr", label: "MRR", note: "Servicios activos normalizados", icon: ChartNoAxesCombined, tone: "mrr" },
  { key: "expensesThisMonth", label: "Gastos del mes", note: "Pagos registrados", icon: Receipt, tone: "expenses", href: "/expenses" },
  { key: "projectedBalance", label: "Balance proyectado", note: "Ingresos menos gastos", icon: Scale, tone: "balance", href: "/expenses" },
] as const;

function projectedBalanceState(value: string) {
  const balance = BigInt(value);
  if (balance < BigInt(0)) return { label: "Déficit proyectado", tone: "negative" } as const;
  if (balance === BigInt(0)) return { label: "Equilibrio proyectado", tone: "neutral" } as const;
  return { label: "Superávit proyectado", tone: "positive" } as const;
}

export function KpiStrip({ metrics, selectedCurrency = "USD" }: { metrics: DashboardMetrics; selectedCurrency?: "USD" | "ARS" }) {
  const balanceState = projectedBalanceState(metrics.projectedBalance[selectedCurrency]);

  return (
    <section className="dashboard-kpis" aria-label="Indicadores del negocio">
      <div className="dashboard-financial-strip">
        {financialCards.map(({ key, label, note, icon: Icon, tone, ...card }) => (
          <article className={`dashboard-kpi dashboard-kpi--${key === "projectedBalance" ? `balance-${balanceState.tone}` : tone}`} key={key}>
            <header><span aria-hidden="true"><Icon size={17} /></span><h2>{"href" in card ? <Link href={card.href}>{label}</Link> : label}</h2></header>
            <div className="dashboard-money-pair">
              <strong>{formatAggregateMoney(metrics[key][selectedCurrency], selectedCurrency)}</strong>
            </div>
            <p>{key === "projectedBalance" ? balanceState.label : note}</p>
          </article>
        ))}
      </div>
      <div className="dashboard-count-strip">
        <article className="dashboard-count-card"><span aria-hidden="true"><Users size={18} /></span><div><strong>{metrics.activeClients}</strong><p>Clientes activos</p></div></article>
        <article className="dashboard-count-card"><span aria-hidden="true"><CalendarClock size={18} /></span><div><strong>{metrics.chargesNextSevenDays}</strong><p>Próximos 7 días</p></div></article>
      </div>
    </section>
  );
}
