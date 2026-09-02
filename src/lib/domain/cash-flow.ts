import type { AggregateMinorUnits, Currency } from "./money";
import {
  subtractAggregate,
  type MoneyByCurrency,
} from "./currency-aggregate";

export interface MonthlyCashFlowInput {
  projectedIncome: MoneyByCurrency;
  actualIncome: MoneyByCurrency;
  projectedExpenses: MoneyByCurrency;
  actualExpenses: MoneyByCurrency;
}

export interface CurrencyCashFlow {
  projectedIncome: AggregateMinorUnits;
  actualIncome: AggregateMinorUnits;
  projectedExpenses: AggregateMinorUnits;
  actualExpenses: AggregateMinorUnits;
  projectedNet: AggregateMinorUnits;
  actualNet: AggregateMinorUnits;
}

export type MonthlyCashFlow = Record<Currency, CurrencyCashFlow>;

function calculateCurrencyCashFlow(
  input: MonthlyCashFlowInput,
  currency: Currency,
): CurrencyCashFlow {
  const projectedIncome = input.projectedIncome[currency];
  const actualIncome = input.actualIncome[currency];
  const projectedExpenses = input.projectedExpenses[currency];
  const actualExpenses = input.actualExpenses[currency];

  return {
    projectedIncome,
    actualIncome,
    projectedExpenses,
    actualExpenses,
    projectedNet: subtractAggregate(projectedIncome, projectedExpenses),
    actualNet: subtractAggregate(actualIncome, actualExpenses),
  };
}

export function calculateMonthlyCashFlow(
  input: MonthlyCashFlowInput,
): MonthlyCashFlow {
  return {
    USD: calculateCurrencyCashFlow(input, "USD"),
    ARS: calculateCurrencyCashFlow(input, "ARS"),
  };
}
