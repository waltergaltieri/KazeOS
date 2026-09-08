import type { Currency } from "@/lib/domain/money";

export const CURRENCY_PREFERENCE_COOKIE = "kazeos_currency";
export const CURRENCY_PREFERENCE_MAX_AGE = 60 * 60 * 24 * 365;

export function parseCurrencyPreference(value: unknown): Currency | undefined {
  return value === "USD" || value === "ARS" ? value : undefined;
}

export function resolveCurrencyPreference(
  requested: unknown,
  remembered: unknown,
): Currency {
  return parseCurrencyPreference(requested)
    ?? parseCurrencyPreference(remembered)
    ?? "USD";
}
