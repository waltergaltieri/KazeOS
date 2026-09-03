import { TriangleAlert } from "lucide-react";
import type { CSSProperties } from "react";

import { formatAggregateMoney, type AggregateMinorUnits, type Currency } from "@/lib/domain/money";
import type { ExpenseCategoryBreakdown, ExpenseDimensionBreakdown } from "@/lib/queries/expenses";

type ExpenseScope = "personal" | "business" | "family" | "friends" | "partner" | "other";
type ExpenseCostType = "fixed" | "variable";

const scopeLabels: Record<ExpenseScope, string> = {
  business: "Negocio",
  personal: "Personal",
  family: "Familia",
  friends: "Amigos",
  partner: "Pareja",
  other: "Otro",
};
const costTypeLabels: Record<ExpenseCostType, string> = {
  fixed: "Fijos",
  variable: "Variables",
};

interface RankedItem {
  id: string;
  icon?: string | null;
  label: string;
  value: AggregateMinorUnits;
}

function percentage(value: bigint, total: bigint): number {
  if (total === BigInt(0)) return 0;
  return Number((value * BigInt(100) + total / BigInt(2)) / total);
}

function RankedBreakdown({
  ariaLabel,
  currency,
  eyebrow,
  items,
  title,
  unavailable = false,
}: {
  ariaLabel: string;
  currency: Currency;
  eyebrow: string;
  items: RankedItem[];
  title: string;
  unavailable?: boolean;
}) {
  const ranked = [...items]
    .filter((item) => BigInt(item.value) !== BigInt(0))
    .sort((left, right) => {
      const difference = BigInt(right.value) - BigInt(left.value);
      return difference === BigInt(0) ? left.label.localeCompare(right.label, "es") : difference > BigInt(0) ? 1 : -1;
    });
  const total = ranked.reduce((sum, item) => sum + BigInt(item.value), BigInt(0));

  return (
    <section className="expense-breakdown-sheet" aria-label={ariaLabel}>
      <header><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div><span>{currency}</span></header>
      {unavailable ? (
        <div className="expense-insight-unavailable expense-insight-unavailable--compact">
          <TriangleAlert aria-hidden="true" size={17} />
          <div><strong>No disponible</strong><p>No pudimos cargar este desglose.</p></div>
        </div>
      ) : ranked.length ? (
        <ol className="expense-breakdown-list">
          {ranked.map((item) => {
            const share = percentage(BigInt(item.value), total);
            return (
              <li key={item.id}>
                <div className="expense-breakdown-copy">
                  <span>{item.icon ? <span aria-hidden="true">{item.icon}</span> : null}{item.label}</span>
                  <strong>{formatAggregateMoney(item.value, currency)}</strong>
                  <span>{share}%</span>
                </div>
                <div className="expense-breakdown-track" role="progressbar" aria-label={`${item.label}: ${share}%`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={share}>
                  <span style={{ "--expense-share": `${share}%` } as CSSProperties} />
                </div>
              </li>
            );
          })}
        </ol>
      ) : <p className="expense-breakdown-empty">Sin gastos proyectados en este período.</p>}
    </section>
  );
}

type ExpenseBreakdownProps = {
  currency: Currency;
} & ({
  unavailable: true;
  byCategory?: never;
  byCostType?: never;
  byScope?: never;
} | {
  unavailable?: false;
  byCategory: ExpenseCategoryBreakdown[];
  byCostType: Array<ExpenseDimensionBreakdown<ExpenseCostType>>;
  byScope: Array<ExpenseDimensionBreakdown<ExpenseScope>>;
});

export function ExpenseBreakdowns(props: ExpenseBreakdownProps) {
  const { currency } = props;
  const byCategory = props.unavailable ? [] : props.byCategory;
  const byScope = props.unavailable ? [] : props.byScope;
  const byCostType = props.unavailable ? [] : props.byCostType;
  return (
    <div className="expense-breakdown-grid">
      <RankedBreakdown
        ariaLabel="Gastos por categoría"
        currency={currency}
        eyebrow="Destino"
        items={byCategory.map((item) => ({ id: item.categoryId, icon: item.icon, label: item.label, value: item.amounts[currency] }))}
        title="Por categoría"
        unavailable={props.unavailable}
      />
      <RankedBreakdown
        ariaLabel="Gastos por ámbito"
        currency={currency}
        eyebrow="Contexto"
        items={byScope.map((item) => ({ id: item.key, label: scopeLabels[item.key], value: item.amounts[currency] }))}
        title="Por ámbito"
        unavailable={props.unavailable}
      />
      <RankedBreakdown
        ariaLabel="Gastos fijos y variables"
        currency={currency}
        eyebrow="Estructura"
        items={byCostType.map((item) => ({ id: item.key, label: costTypeLabels[item.key], value: item.amounts[currency] }))}
        title="Fijo frente a variable"
        unavailable={props.unavailable}
      />
    </div>
  );
}
