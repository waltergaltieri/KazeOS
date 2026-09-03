import type { MonthlyCashFlow } from "@/lib/domain/cash-flow";
import { formatAggregateMoney, type AggregateMinorUnits, type Currency } from "@/lib/domain/money";
import type { ExpenseSummary as ExpenseSummaryData } from "@/lib/queries/expenses";

const metricDefinitions = [
  { key: "actual", label: "Gastado", note: "Pagado en el período", tone: "actual" },
  { key: "pending", label: "Pendiente", note: "Aún sin pagar", tone: "pending" },
  { key: "overdue", label: "Vencido", note: "Fuera de término", tone: "overdue" },
  { key: "projected", label: "Proyectado", note: "Total comprometido", tone: "projected" },
  { key: "fixed", label: "Fijo", note: "Costos previsibles", tone: "fixed" },
  { key: "variable", label: "Variable", note: "Costos flexibles", tone: "variable" },
] as const;

function negate(value: AggregateMinorUnits): AggregateMinorUnits {
  const amount = BigInt(value);
  return (amount === BigInt(0) ? "0" : (-amount).toString()) as AggregateMinorUnits;
}

function ResultColumn({
  actual,
  currency,
  expenses,
  income,
  net,
}: {
  actual: boolean;
  currency: Currency;
  expenses: AggregateMinorUnits;
  income: AggregateMinorUnits;
  net: AggregateMinorUnits;
}) {
  const title = actual ? "Resultado real" : "Resultado proyectado";
  const netAmount = BigInt(net);
  const isNegative = netAmount < BigInt(0);
  const isNeutral = netAmount === BigInt(0);
  return (
    <article className="expense-result-column" role="group" aria-label={title}>
      <header>
        <div><p>{actual ? "Movimientos registrados" : "Obligaciones previstas"}</p><h3>{title}</h3></div>
        <span className={`expense-result-state${isNegative ? " is-negative" : isNeutral ? " is-neutral" : ""}`}>
          {isNegative ? "Déficit" : isNeutral ? "Equilibrio" : "Superávit"}
        </span>
      </header>
      <dl>
        <div><dt>Ingresos</dt><dd>{formatAggregateMoney(income, currency)}</dd></div>
        <div><dt>Gastos</dt><dd className="expense-outflow">{formatAggregateMoney(negate(expenses), currency)}</dd></div>
        <div className="expense-result-total"><dt>Resultado</dt><dd className={isNegative ? "is-negative" : undefined}>{formatAggregateMoney(net, currency)}</dd></div>
      </dl>
    </article>
  );
}

export function ExpenseSummary({
  cashFlow,
  currency,
  summary,
}: {
  cashFlow: MonthlyCashFlow;
  currency: Currency;
  summary: ExpenseSummaryData;
}) {
  const activeSummary = summary[currency];
  const activeCashFlow = cashFlow[currency];

  return (
    <section className="expense-insight-summary" aria-label={`Resumen de gastos ${currency}`}>
      <div className="expense-summary-strip">
        {metricDefinitions.map(({ key, label, note, tone }) => (
          <article className={`expense-summary-metric expense-summary-metric--${tone}`} key={key}>
            <span>{label}</span>
            <strong>{formatAggregateMoney(activeSummary[key], currency)}</strong>
            <small>{note}</small>
          </article>
        ))}
      </div>

      <div className="expense-results-sheet">
        <header className="expense-results-heading">
          <div><p className="eyebrow">Caja del período</p><h2>Proyección frente a realidad</h2></div>
          <div><span>Compromiso fijo mensual</span><strong>{formatAggregateMoney(activeSummary.monthlyFixedCommitments, currency)}</strong></div>
        </header>
        <div className="expense-results-grid">
          <ResultColumn
            actual={false}
            currency={currency}
            expenses={activeCashFlow.projectedExpenses}
            income={activeCashFlow.projectedIncome}
            net={activeCashFlow.projectedNet}
          />
          <ResultColumn
            actual
            currency={currency}
            expenses={activeCashFlow.actualExpenses}
            income={activeCashFlow.actualIncome}
            net={activeCashFlow.actualNet}
          />
        </div>
      </div>
    </section>
  );
}
