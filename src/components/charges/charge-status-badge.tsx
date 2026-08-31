import type { DisplayChargeStatus } from "@/lib/queries/charges";
const labels: Record<DisplayChargeStatus, string> = { pending: "Próximo", due_today: "Vence hoy", overdue: "Vencido", partial: "Parcial", paid: "Cobrado", cancelled: "Cancelado" };
export function ChargeStatusBadge({ status }: { status: DisplayChargeStatus }) { return <span className={`charge-status charge-status--${status}`}>{labels[status]}</span>; }
