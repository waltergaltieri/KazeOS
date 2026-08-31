import type { Currency } from "./money";

export type BillingType = "recurring" | "one_time";
export type BillingFrequency =
  | "monthly"
  | "quarterly"
  | "yearly"
  | "one_time";
export type ServiceStatus = "active" | "paused" | "cancelled";

export interface MrrServiceInput {
  amountMinor: number;
  billingFrequency: BillingFrequency;
  billingType: BillingType;
  currency: Currency;
  status: ServiceStatus;
}

export type MrrByCurrency = Record<Currency, number>;

const billingTypes: readonly BillingType[] = ["recurring", "one_time"];
const billingFrequencies: readonly BillingFrequency[] = [
  "monthly",
  "quarterly",
  "yearly",
  "one_time",
];
const currencies: readonly Currency[] = ["USD", "ARS"];
const serviceStatuses: readonly ServiceStatus[] = [
  "active",
  "paused",
  "cancelled",
];
const maxSafeMinorUnits = BigInt(Number.MAX_SAFE_INTEGER);

function validateService(service: Readonly<MrrServiceInput>): void {
  if (!Number.isSafeInteger(service.amountMinor) || service.amountMinor < 0) {
    throw new RangeError(
      "Service amount must be a nonnegative safe integer in minor units",
    );
  }

  if (!billingTypes.includes(service.billingType)) {
    throw new RangeError("Invalid billing type");
  }

  if (!billingFrequencies.includes(service.billingFrequency)) {
    throw new RangeError("Invalid billing frequency");
  }

  if (!currencies.includes(service.currency)) {
    throw new RangeError("Invalid currency");
  }

  if (!serviceStatuses.includes(service.status)) {
    throw new RangeError("Invalid service status");
  }
}

function toMonthlyTwelfths(
  amountMinor: number,
  frequency: Exclude<BillingFrequency, "one_time">,
): bigint {
  const weight =
    frequency === "monthly"
      ? BigInt(12)
      : frequency === "quarterly"
        ? BigInt(4)
        : BigInt(1);

  return BigInt(amountMinor) * weight;
}

function roundMonthlyTwelfths(monthlyTwelfths: bigint): bigint {
  const denominator = BigInt(12);
  const quotient = monthlyTwelfths / denominator;
  const remainder = monthlyTwelfths % denominator;

  return (
    quotient +
    (remainder * BigInt(2) >= denominator ? BigInt(1) : BigInt(0))
  );
}

/**
 * Calculates MRR independently for USD and ARS. Missing currencies are
 * represented by zero; no conversion or cross-currency total is produced.
 * Each service contributes exact twelfths of a monthly minor unit (monthly
 * amounts use a 12 weight, quarterly 4, and yearly 1). Each currency total is
 * rounded once to the nearest minor unit, with exact halves rounded up.
 */
export function calculateMrr(
  services: readonly Readonly<MrrServiceInput>[],
): MrrByCurrency {
  const totals: Record<Currency, bigint> = {
    USD: BigInt(0),
    ARS: BigInt(0),
  };

  for (const service of services) {
    validateService(service);

    if (
      service.status !== "active" ||
      service.billingType === "one_time" ||
      service.billingFrequency === "one_time"
    ) {
      continue;
    }

    totals[service.currency] += toMonthlyTwelfths(
      service.amountMinor,
      service.billingFrequency,
    );
  }

  const roundedUsd = roundMonthlyTwelfths(totals.USD);
  const roundedArs = roundMonthlyTwelfths(totals.ARS);

  if (roundedUsd > maxSafeMinorUnits || roundedArs > maxSafeMinorUnits) {
    throw new RangeError("MRR total exceeds the safe integer range");
  }

  return {
    USD: Number(roundedUsd),
    ARS: Number(roundedArs),
  };
}
