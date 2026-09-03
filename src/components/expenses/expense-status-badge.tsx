import type { ExpenseStatus } from "@/lib/domain/expense-status";

const labels: Record<ExpenseStatus, string> = {
  planned: "Planificado",
  pending: "Pendiente",
  overdue: "Vencido",
  paid: "Pagado",
  cancelled: "Cancelado",
};

export function ExpenseStatusBadge({ status }: { status: ExpenseStatus }) {
  return <span className={`expense-status expense-status--${status}`}>{labels[status]}</span>;
}
