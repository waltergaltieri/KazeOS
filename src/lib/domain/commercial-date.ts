export const BUSINESS_TIME_ZONE = "America/Argentina/Buenos_Aires";

const businessDateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "2-digit",
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
});

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
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
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
