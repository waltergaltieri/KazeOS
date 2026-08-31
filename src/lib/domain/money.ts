export type Currency = "USD" | "ARS";

export interface ParseMoneyOptions {
  allowNegative?: boolean;
}

const integerFormatter = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 0,
  useGrouping: true,
});
const MAX_SAFE_MINOR_UNITS = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_MAJOR_DIGITS = (MAX_SAFE_MINOR_UNITS / BigInt(100)).toString().length;
const MAX_GROUPING_SEPARATORS = Math.floor((MAX_MAJOR_DIGITS - 1) / 3);
const MAX_TRIMMED_INPUT_LENGTH =
  1 + MAX_MAJOR_DIGITS + MAX_GROUPING_SEPARATORS + 1 + 2;

export function formatMoney(amountMinor: number, currency: Currency): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError("Money amount must be a safe integer in minor units");
  }

  const minorUnits = BigInt(amountMinor);
  const isNegative = minorUnits < BigInt(0);
  const absoluteMinor = isNegative ? -minorUnits : minorUnits;
  const major = absoluteMinor / BigInt(100);
  const minor = absoluteMinor % BigInt(100);

  return `${currency}\u00a0${isNegative ? "-" : ""}${integerFormatter.format(major)},${minor
    .toString()
    .padStart(2, "0")}`;
}

/**
 * Converts a decimal input to minor units using digit-string and BigInt
 * arithmetic. A comma is the Argentine decimal separator. A lone dot with
 * one or two trailing digits is an API-style decimal separator; with exactly
 * three trailing digits it is grouping only when its leading group is
 * nonzero, so ambiguous zero-prefixed dot input is rejected.
 */
export function parseMoneyInput(
  input: string,
  options: ParseMoneyOptions = {},
): number {
  const trimmedInput = input.trim();

  if (trimmedInput.length > MAX_TRIMMED_INPUT_LENGTH) {
    throw new RangeError("Money amount input is too long");
  }

  const isNegative = trimmedInput.startsWith("-");

  if (isNegative && !options.allowNegative) {
    throw new RangeError("Negative money amounts are not allowed");
  }

  const normalizedInput = isNegative ? trimmedInput.slice(1) : trimmedInput;
  const apiDecimalMatch = /^(\d+)\.(\d{1,2})$/.exec(normalizedInput);
  const match = apiDecimalMatch
    ? [apiDecimalMatch[0], apiDecimalMatch[1], apiDecimalMatch[2]]
    : /^([1-9]\d{0,2}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(
        normalizedInput,
      );

  if (!match) {
    throw new RangeError("Invalid money amount");
  }

  const majorDigits = match[1].replaceAll(".", "");
  const minorDigits = (match[2] ?? "").padEnd(2, "0");

  if (majorDigits.length > MAX_MAJOR_DIGITS) {
    throw new RangeError("Money amount input is too long");
  }

  const amountMinor =
    BigInt(majorDigits) * BigInt(100) + BigInt(minorDigits || "0");

  if (amountMinor > MAX_SAFE_MINOR_UNITS) {
    throw new RangeError("Money amount exceeds the safe integer range");
  }

  const parsedAmount = Number(amountMinor);
  return isNegative && parsedAmount !== 0 ? -parsedAmount : parsedAmount;
}
