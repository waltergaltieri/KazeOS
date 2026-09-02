import {
  compareCommercialDates,
  validateCommercialDate,
} from "./commercial-date";

export type PersistedExpenseStatus =
  | "planned"
  | "pending"
  | "paid"
  | "cancelled";
export type ExpenseStatus = PersistedExpenseStatus | "overdue";

export function getExpenseStatus(
  expense: {
    dueDate: string;
    status: PersistedExpenseStatus;
  },
  today: string,
): ExpenseStatus {
  validateCommercialDate(expense.dueDate);
  validateCommercialDate(today);

  if (expense.status === "paid" || expense.status === "cancelled") {
    return expense.status;
  }

  return compareCommercialDates(expense.dueDate, today) < 0
    ? "overdue"
    : expense.status;
}
