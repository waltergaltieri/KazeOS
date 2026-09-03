import type { Currency } from "./money";
import {
  addCommercialPeriod,
  compareCommercialDates,
  type CommercialPeriod,
  validateCommercialDate,
} from "./commercial-date";

export type RecurrenceBillingFrequency = CommercialPeriod | "one_time";
export type RecurrenceBillingType = "recurring" | "one_time";
export type RecurrenceServiceStatus = "active" | "paused" | "cancelled";

export interface RecurringServiceInput {
  amountMinor: number;
  billingDay: number | null;
  billingFrequency: RecurrenceBillingFrequency;
  billingType: RecurrenceBillingType;
  currency: Currency;
  endDate: string | null;
  name: string;
  startDate: string;
  status: RecurrenceServiceStatus;
}

export interface ChargePeriodCandidate {
  amountMinor: number;
  currency: Currency;
  description: string;
  dueDate: string;
  periodKey: string;
}

export interface RecurringScheduleInput {
  amountMinor: number;
  billingDay: number;
  endDate: string | null;
  frequency: CommercialPeriod;
  label: string;
  startDate: string;
}

export interface RecurringPeriodCandidate {
  amountMinor: number;
  description: string;
  dueDate: string;
  periodKey: string;
}

const frequencies: readonly RecurrenceBillingFrequency[] = [
  "monthly",
  "quarterly",
  "yearly",
  "one_time",
];
const scheduleFrequencies: readonly CommercialPeriod[] = [
  "monthly",
  "quarterly",
  "yearly",
];
const billingTypes: readonly RecurrenceBillingType[] = ["recurring", "one_time"];
const currencies: readonly Currency[] = ["USD", "ARS"];
const statuses: readonly RecurrenceServiceStatus[] = [
  "active",
  "paused",
  "cancelled",
];

function daysInMonth(year: number, month: number): number {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

  return [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1]!;
}

function monthIndexFromDate(date: string): number {
  const [year, month] = date.split("-").map(Number);

  return (year - 1) * 12 + month - 1;
}

function dateInMonth(monthIndex: number, preferredDay: number): string {
  const maxMonthIndex = 9_999 * 12 - 1;

  if (monthIndex < 0 || monthIndex > maxMonthIndex) {
    throw new RangeError("Recurring period exceeds the supported date range");
  }

  const year = Math.floor(monthIndex / 12) + 1;
  const month = (monthIndex % 12) + 1;
  const day = Math.min(preferredDay, daysInMonth(year, month));

  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

function buildPeriodKey(
  dueDate: string,
  frequency: CommercialPeriod,
): string {
  const year = dueDate.slice(0, 4);
  const month = dueDate.slice(5, 7);

  if (frequency === "monthly") {
    return `monthly:${year}-${month}`;
  }

  if (frequency === "quarterly") {
    return `quarterly:${year}-Q${Math.ceil(Number(month) / 3)}`;
  }

  return `yearly:${year}`;
}

function validateService(service: Readonly<RecurringServiceInput>): void {
  if (!Number.isSafeInteger(service.amountMinor) || service.amountMinor <= 0) {
    throw new RangeError("Service amount must be a positive safe integer");
  }

  if (!billingTypes.includes(service.billingType)) {
    throw new RangeError("Invalid billing type");
  }

  if (!frequencies.includes(service.billingFrequency)) {
    throw new RangeError("Invalid billing frequency");
  }

  if (!currencies.includes(service.currency)) {
    throw new RangeError("Invalid currency");
  }

  if (!statuses.includes(service.status)) {
    throw new RangeError("Invalid service status");
  }

  if (typeof service.name !== "string" || service.name.trim().length === 0) {
    throw new RangeError("Service name must not be blank");
  }

  validateCommercialDate(service.startDate);

  if (service.endDate !== null) {
    validateCommercialDate(service.endDate);

    if (compareCommercialDates(service.endDate, service.startDate) < 0) {
      throw new RangeError("Service end date cannot precede its start date");
    }
  }

  const recurring = service.billingType === "recurring";
  const validBillingDay =
    Number.isSafeInteger(service.billingDay) &&
    service.billingDay !== null &&
    service.billingDay >= 1 &&
    service.billingDay <= 31;

  if (
    (recurring &&
      (service.billingFrequency === "one_time" || !validBillingDay)) ||
    (!recurring &&
      (service.billingFrequency !== "one_time" || service.billingDay !== null))
  ) {
    throw new RangeError("Inconsistent service billing configuration");
  }
}

function validateSchedule(schedule: Readonly<RecurringScheduleInput>): void {
  if (!Number.isSafeInteger(schedule.amountMinor) || schedule.amountMinor <= 0) {
    throw new RangeError("Schedule amount must be a positive safe integer");
  }

  if (
    !Number.isSafeInteger(schedule.billingDay) ||
    schedule.billingDay < 1 ||
    schedule.billingDay > 31
  ) {
    throw new RangeError("Schedule billing day must be between 1 and 31");
  }

  if (!scheduleFrequencies.includes(schedule.frequency)) {
    throw new RangeError("Invalid schedule frequency");
  }

  if (typeof schedule.label !== "string" || schedule.label.trim().length === 0) {
    throw new RangeError("Schedule label must not be blank");
  }

  validateCommercialDate(schedule.startDate);

  if (schedule.endDate !== null) {
    validateCommercialDate(schedule.endDate);

    if (compareCommercialDates(schedule.endDate, schedule.startDate) < 0) {
      throw new RangeError("Schedule end date cannot precede its start date");
    }
  }
}

export function nextDueDate(
  anchorDate: string,
  frequency: CommercialPeriod,
  count = 1,
): string {
  return addCommercialPeriod(anchorDate, frequency, count);
}

/**
 * Builds recurring occurrences within [asOf, asOf + horizonMonths). The
 * billing day remains the anchor across shorter commercial months. End dates
 * are inclusive.
 */
export function buildRecurringPeriods(
  schedule: Readonly<RecurringScheduleInput>,
  asOf: string,
  horizonMonths = 3,
): RecurringPeriodCandidate[] {
  validateSchedule(schedule);
  validateCommercialDate(asOf);

  if (!Number.isSafeInteger(horizonMonths) || horizonMonths < 1) {
    throw new RangeError("Horizon must be a positive safe number of months");
  }

  const horizonEnd = addCommercialPeriod(asOf, "monthly", horizonMonths);
  const monthsPerOccurrence =
    schedule.frequency === "monthly"
      ? 1
      : schedule.frequency === "quarterly"
        ? 3
        : 12;
  let firstDueMonth = monthIndexFromDate(schedule.startDate);

  if (
    compareCommercialDates(
      dateInMonth(firstDueMonth, schedule.billingDay),
      schedule.startDate,
    ) < 0
  ) {
    firstDueMonth += 1;
  }

  const candidates: RecurringPeriodCandidate[] = [];

  for (let occurrence = 0; ; occurrence += 1) {
    const dueDate = dateInMonth(
      firstDueMonth + occurrence * monthsPerOccurrence,
      schedule.billingDay,
    );

    if (compareCommercialDates(dueDate, horizonEnd) >= 0) {
      break;
    }

    if (
      compareCommercialDates(dueDate, asOf) >= 0 &&
      (schedule.endDate === null ||
        compareCommercialDates(dueDate, schedule.endDate) <= 0)
    ) {
      candidates.push({
        amountMinor: schedule.amountMinor,
        description: schedule.label.trim(),
        dueDate,
        periodKey: buildPeriodKey(dueDate, schedule.frequency),
      });
    }

    if (
      schedule.endDate !== null &&
      compareCommercialDates(dueDate, schedule.endDate) > 0
    ) {
      break;
    }
  }

  return candidates;
}

export function firstRecurringDueDate(
  schedule: Readonly<RecurringScheduleInput>,
): string {
  return buildRecurringPeriods(schedule, schedule.startDate, 13)[0]?.dueDate
    ?? schedule.startDate;
}

export function resolveRecurringEditAnchor(
  current: Readonly<RecurringScheduleInput>,
  submittedDueDate: string,
): Pick<RecurringScheduleInput, "billingDay" | "startDate"> {
  validateCommercialDate(submittedDueDate);

  if (submittedDueDate === firstRecurringDueDate(current)) {
    return {
      billingDay: current.billingDay,
      startDate: current.startDate,
    };
  }

  return {
    billingDay: Number(submittedDueDate.slice(8, 10)),
    startDate: submittedDueDate,
  };
}

/**
 * Builds occurrences within [asOf, asOf + horizonMonths). The original billing
 * day remains the anchor, so a 31st clamps in short months and returns to the
 * 31st later. Service end dates are inclusive.
 */
export function buildChargePeriods(
  service: Readonly<RecurringServiceInput>,
  asOf: string,
  horizonMonths = 3,
): ChargePeriodCandidate[] {
  validateService(service);
  validateCommercialDate(asOf);

  if (!Number.isSafeInteger(horizonMonths) || horizonMonths < 1) {
    throw new RangeError("Horizon must be a positive safe number of months");
  }

  if (service.billingType !== "recurring" || service.status !== "active") {
    return [];
  }

  return buildRecurringPeriods(
    {
      amountMinor: service.amountMinor,
      billingDay: service.billingDay!,
      endDate: service.endDate,
      frequency: service.billingFrequency as CommercialPeriod,
      label: service.name,
      startDate: service.startDate,
    },
    asOf,
    horizonMonths,
  ).map((candidate) => ({ ...candidate, currency: service.currency }));
}
