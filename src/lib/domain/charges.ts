import {
  compareCommercialDates,
  validateCommercialDate,
} from "./commercial-date";

export type PersistedChargeStatus =
  | "pending"
  | "partial"
  | "paid"
  | "cancelled";

export type ChargeStatus =
  | PersistedChargeStatus
  | "due_today"
  | "overdue";

export interface ChargeStatusInput {
  amountMinor: number;
  amountPaidMinor: number;
  dueDate: string;
  status?: PersistedChargeStatus;
}

const persistedChargeStatuses: readonly PersistedChargeStatus[] = [
  "pending",
  "partial",
  "paid",
  "cancelled",
];

function validateNonnegativeMinorUnits(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      "Money amount must be a nonnegative safe integer in minor units",
    );
  }
}

function validatePersistedStatus(status: PersistedChargeStatus | undefined): void {
  if (status !== undefined && !persistedChargeStatuses.includes(status)) {
    throw new RangeError("Invalid persisted charge status");
  }
}

export function getChargeStatus(
  charge: Readonly<ChargeStatusInput>,
  today: string,
): ChargeStatus {
  validateNonnegativeMinorUnits(charge.amountMinor);
  validateNonnegativeMinorUnits(charge.amountPaidMinor);
  validatePersistedStatus(charge.status);
  validateCommercialDate(charge.dueDate);
  validateCommercialDate(today);

  if (charge.status === "cancelled") {
    return "cancelled";
  }

  if (charge.amountPaidMinor >= charge.amountMinor) {
    return "paid";
  }

  if (charge.amountPaidMinor > 0) {
    return "partial";
  }

  const dueDateComparison = compareCommercialDates(charge.dueDate, today);

  if (dueDateComparison < 0) {
    return "overdue";
  }

  return dueDateComparison === 0 ? "due_today" : "pending";
}

export function getChargeBalance(
  amountMinor: number,
  amountPaidMinor: number,
): number {
  validateNonnegativeMinorUnits(amountMinor);
  validateNonnegativeMinorUnits(amountPaidMinor);

  return amountPaidMinor >= amountMinor ? 0 : amountMinor - amountPaidMinor;
}

export function getChargeOverpayment(
  amountMinor: number,
  amountPaidMinor: number,
): number {
  validateNonnegativeMinorUnits(amountMinor);
  validateNonnegativeMinorUnits(amountPaidMinor);

  return amountPaidMinor <= amountMinor ? 0 : amountPaidMinor - amountMinor;
}
