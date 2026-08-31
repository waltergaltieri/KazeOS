import { addCommercialPeriod, validateCommercialDate } from "./commercial-date";

export interface MonthlyTaskSource {
  clientId: string | null;
  description: string | null;
  dueDate: string;
  ownerId: string;
  priority: "low" | "medium" | "high";
  recurrenceAnchorDate?: string;
  rootId: string;
  title: string;
}

export function buildNextMonthlyTask(source: Readonly<MonthlyTaskSource>) {
  const nextMonth = addCommercialPeriod(source.dueDate, "monthly");
  const anchorDate = validateCommercialDate(source.recurrenceAnchorDate ?? source.dueDate);
  const [year, month] = nextMonth.split("-").map(Number);
  const anchorDay = Number(anchorDate.slice(-2));
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  const dueDate = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${Math.min(anchorDay, monthDays).toString().padStart(2, "0")}`;
  return {
    clientId: source.clientId,
    description: source.description,
    dueDate,
    ownerId: source.ownerId,
    parentId: source.rootId,
    priority: source.priority,
    recurrence: null,
    recurrenceKey: dueDate,
    recurring: false,
    status: "pending" as const,
    title: source.title,
  };
}
