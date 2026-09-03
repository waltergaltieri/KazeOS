import { ArrowRight, CircleDollarSign, Receipt, Scale } from "lucide-react";
import Link from "next/link";

import type { MonthlyCashFlow } from "@/lib/domain/cash-flow";
import { formatAggregateMoney, type Currency } from "@/lib/domain/money";

const rows = [
  { key: "projectedIncome", label: "Ingresos proyectados", icon: CircleDollarSign, tone: "income" },
  { key: "projectedExpenses", label: "Gastos proyectados", icon: Receipt, tone: "expense" },
  { key: "projectedNet", label: "Balance proyectado", icon: Scale, tone: "net" },
] as const;

export function IncomeExpenseComparison({
  cashFlow,
  selectedCurrency,
}: {
  cashFlow: MonthlyCashFlow;
  selectedCurrency: Currency;
}) {
  const selected = cashFlow[selectedCurrency];

  return (
    <section className="dashboard-panel dashboard-comparison" aria-labelledby="income-expense-title">
      <header className="dashboard-panel__heading">
        <div><p className="eyebrow">Caja proyectada</p><h2 id="income-expense-title">Ingresos vs gastos — este mes</h2></div>
        <Link href="/expenses">Ver gastos <ArrowRight aria-hidden="true" size={14} /></Link>
      </header>
      <dl className="dashboard-comparison-list">
        {rows.map(({ key, label, icon: Icon, tone }) => (
          <div className={`dashboard-comparison-row dashboard-comparison-row--${tone}`} key={key}>
            <dt><span aria-hidden="true"><Icon size={16} /></span>{label}</dt>
            <dd>{formatAggregateMoney(selected[key], selectedCurrency)}</dd>
          </div>
        ))}
      </dl>
      <p className="dashboard-comparison-note">Compromisos del mes, separados por moneda.</p>
    </section>
  );
}
