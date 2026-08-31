export const BUSINESS_TIME_ZONE = "America/Argentina/Buenos_Aires";

export type CommercialPeriod = "monthly" | "quarterly" | "yearly";

const businessDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "2-digit",
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
});

function getDaysInMonth(year: number, month: number): number | undefined {
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
  ][month - 1];
}

export function todayInBusinessZone(instant: Date): string {
  const parts = businessDateFormatter.formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

export function validateCommercialDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    throw new RangeError("Invalid commercial date");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const daysInMonth = getDaysInMonth(year, month);

  if (year === 0 || daysInMonth === undefined || day < 1 || day > daysInMonth) {
    throw new RangeError("Invalid commercial date");
  }

  return value;
}

export function compareCommercialDates(a: string, b: string): -1 | 0 | 1 {
  validateCommercialDate(a);
  validateCommercialDate(b);

  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
}

/**
 * Adds whole commercial periods from the original date and clamps the day to
 * the target month's end. Count must be a positive safe integer.
 */
export function addCommercialPeriod(
  date: string,
  frequency: CommercialPeriod,
  count = 1,
): string {
  validateCommercialDate(date);

  const monthsPerPeriod =
    frequency === "monthly"
      ? 1
      : frequency === "quarterly"
        ? 3
        : frequency === "yearly"
          ? 12
          : undefined;

  if (
    monthsPerPeriod === undefined ||
    !Number.isSafeInteger(count) ||
    count < 1
  ) {
    throw new RangeError("Invalid commercial period");
  }

  const [year, month, day] = date.split("-").map(Number);
  const sourceMonthIndex = (year - 1) * 12 + month - 1;
  const maxMonthIndex = 9_999 * 12 - 1;
  const maxCount = Math.floor(
    (maxMonthIndex - sourceMonthIndex) / monthsPerPeriod,
  );

  if (count > maxCount) {
    throw new RangeError("Commercial period exceeds the supported date range");
  }

  const targetMonthIndex = sourceMonthIndex + monthsPerPeriod * count;
  const targetYear = Math.floor(targetMonthIndex / 12) + 1;
  const targetMonth = (targetMonthIndex % 12) + 1;
  const targetDays = getDaysInMonth(targetYear, targetMonth);

  if (targetDays === undefined) {
    throw new RangeError("Invalid target commercial date");
  }

  const targetDay = Math.min(day, targetDays);

  return `${targetYear.toString().padStart(4, "0")}-${targetMonth
    .toString()
    .padStart(2, "0")}-${targetDay.toString().padStart(2, "0")}`;
}
