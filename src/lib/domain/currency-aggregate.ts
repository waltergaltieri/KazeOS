import type { AggregateMinorUnits, Currency } from "./money";

export type MoneyByCurrency = Record<Currency, AggregateMinorUnits>;

export interface CurrencyAmount {
  amountMinor: AggregateMinorUnits;
  currency: Currency;
}

const INTEGER_MINOR_UNITS = /^-?(0|[1-9]\d*)$/;

function parseAggregate(value: AggregateMinorUnits): bigint {
  if (!INTEGER_MINOR_UNITS.test(value)) {
    throw new RangeError("Aggregate amount must be integer minor units");
  }

  return BigInt(value);
}

export const zeroByCurrency = (): MoneyByCurrency => ({
  USD: "0",
  ARS: "0",
});

export function aggregateByCurrency(
  amounts: readonly CurrencyAmount[],
): MoneyByCurrency {
  const totals: Record<Currency, bigint> = {
    USD: BigInt(0),
    ARS: BigInt(0),
  };

  for (const amount of amounts) {
    totals[amount.currency] += parseAggregate(amount.amountMinor);
  }

  return {
    USD: totals.USD.toString() as AggregateMinorUnits,
    ARS: totals.ARS.toString() as AggregateMinorUnits,
  };
}

export function calculateExpensesByCurrency(
  expenses: readonly CurrencyAmount[],
): MoneyByCurrency {
  return aggregateByCurrency(expenses);
}

export function subtractAggregate(
  left: AggregateMinorUnits,
  right: AggregateMinorUnits,
): AggregateMinorUnits {
  return `${parseAggregate(left) - parseAggregate(right)}`;
}
