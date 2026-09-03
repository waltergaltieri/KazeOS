import { CalendarClock, Pencil } from "lucide-react";
import Link from "next/link";

import { formatMoney } from "@/lib/domain/money";
import { buildRecurringPeriods } from "@/lib/domain/recurrence";
import type { RecurringExpenseListItem } from "@/lib/queries/expenses";

const frequencyLabels = { monthly: "Mensual", quarterly: "Trimestral", yearly: "Anual", one_time: "Única" } as const;
const statusLabels = { active: "Activa", paused: "Pausada", cancelled: "Cancelada" } as const;

function nextDate(item: RecurringExpenseListItem, today: string) {
  if (item.status !== "active" || item.frequency === "one_time") return null;
  return buildRecurringPeriods({
    amountMinor: item.amountMinor,
    billingDay: item.billingDay,
    endDate: item.endDate,
    frequency: item.frequency,
    label: item.title,
    startDate: item.startDate,
  }, today, 13)[0]?.dueDate ?? null;
}

function shortDate(value: string) { return value.split("-").reverse().join("/"); }

export function RecurringExpenseList({ recurringExpenses, today }: { recurringExpenses: RecurringExpenseListItem[]; today: string }) {
  if (!recurringExpenses.length) return <div className="recurring-expense-empty"><CalendarClock size={20} aria-hidden="true" /><p>No hay compromisos recurrentes todavía.</p><Link className="secondary-button" href="/expenses/new?recurring=true">Crear recurrencia</Link></div>;
  return <ol className="recurring-expense-list">{recurringExpenses.map((item) => {
    const upcoming = nextDate(item, today);
    return <li key={item.id}>
      <span className={`recurring-expense-mark recurring-expense-mark--${item.status}`} aria-hidden="true"><CalendarClock size={16} /></span>
      <div className="recurring-expense-copy"><strong>{item.title}</strong><span>{item.category.name} · {frequencyLabels[item.frequency]} · día {item.billingDay}</span><small>{upcoming ? `Próximo: ${shortDate(upcoming)}` : "Sin próxima fecha"}</small></div>
      <div className="recurring-expense-meta"><span className={`recurring-expense-status recurring-expense-status--${item.status}`}>{statusLabels[item.status]}</span><strong className="money-data">{formatMoney(item.amountMinor, item.currency)}</strong>{item.status !== "cancelled" ? <Link className="icon-button" href={`/expenses/recurring/${item.id}/edit`} aria-label={`Editar recurrencia ${item.title}`}><Pencil size={15} /></Link> : null}</div>
    </li>;
  })}</ol>;
}
