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

/**
 * Normalizes a service amount to monthly minor units. Fractional minor units
 * are rounded independently per service to the nearest unit, with exact halves
 * rounded up. BigInt keeps the quotient and remainder deterministic.
 */
function normalizeMonthlyAmount(
  amountMinor: number,
  frequency: Exclude<BillingFrequency, "one_time">,
): bigint {
  const divisor =
    frequency === "monthly"
      ? BigInt(1)
      : frequency === "quarterly"
        ? BigInt(3)
        : BigInt(12);
  const amount = BigInt(amountMinor);
  const quotient = amount / divisor;
  const remainder = amount % divisor;

  return quotient + (remainder * BigInt(2) >= divisor ? BigInt(1) : BigInt(0));
}

/**
 * Calculates MRR independently for USD and ARS. Missing currencies are
 * represented by zero; no conversion or cross-currency total is produced.
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

    totals[service.currency] += normalizeMonthlyAmount(
      service.amountMinor,
      service.billingFrequency,
    );
  }

  if (totals.USD > maxSafeMinorUnits || totals.ARS > maxSafeMinorUnits) {
    throw new RangeError("MRR total exceeds the safe integer range");
  }

  return {
    USD: Number(totals.USD),
    ARS: Number(totals.ARS),
  };
}
