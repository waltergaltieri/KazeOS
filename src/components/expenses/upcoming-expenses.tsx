import { CalendarClock, ChevronRight, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { formatMoney, type Currency } from "@/lib/domain/money";
import type { ExpenseListItem } from "@/lib/queries/expenses";
import { ExpenseStatusBadge } from "./expense-status-badge";

function shortDate(value: string) {
  return value.split("-").reverse().join("/");
}

type UpcomingExpensesProps = {
  currency: Currency;
  today: string;
} & ({
  unavailable: true;
  expenses?: never;
} | {
  unavailable?: false;
  expenses: ExpenseListItem[];
});

export function UpcomingExpenses(props: UpcomingExpensesProps) {
  const { currency, today } = props;
  const expenses = props.unavailable ? [] : props.expenses;
  const ordered = expenses
    .filter((expense) => expense.currency === currency)
    .sort((left, right) => {
      const leftOverdue = left.status === "overdue" || left.dueDate < today;
      const rightOverdue = right.status === "overdue" || right.dueDate < today;
      return Number(rightOverdue) - Number(leftOverdue)
        || left.dueDate.localeCompare(right.dueDate)
        || left.id.localeCompare(right.id);
    });

  return (
    <section className="upcoming-expense-sheet" aria-labelledby="upcoming-expenses-title">
      <header>
        <div><p className="eyebrow">Agenda de obligaciones</p><h2 id="upcoming-expenses-title">Próximos gastos</h2></div>
        <Link href={`/expenses?currency=${currency}&status=pending`}>Ver pendientes <ChevronRight size={14} aria-hidden="true" /></Link>
      </header>
      {props.unavailable ? (
        <div className="expense-insight-unavailable expense-insight-unavailable--compact">
          <TriangleAlert aria-hidden="true" size={17} />
          <div><strong>No disponible</strong><p>No pudimos cargar los próximos gastos.</p></div>
        </div>
      ) : ordered.length ? (
        <ol className="upcoming-expense-list">
          {ordered.map((expense) => {
            const overdue = expense.status === "overdue" || expense.dueDate < today;
            return (
              <li className={overdue ? "is-overdue" : undefined} key={expense.id}>
                <span className="upcoming-expense-mark" aria-hidden="true"><CalendarClock size={15} /></span>
                <div><strong>{expense.title}</strong><span>{expense.category.name}{expense.vendor ? ` · ${expense.vendor}` : ""}</span></div>
                <time dateTime={expense.dueDate}>{shortDate(expense.dueDate)}</time>
                <ExpenseStatusBadge status={overdue ? "overdue" : expense.status} />
                <strong className="money-data">{formatMoney(expense.amountMinor, expense.currency)}</strong>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="upcoming-expense-empty">
          <CalendarClock size={21} aria-hidden="true" />
          <div><strong>Agenda despejada</strong><p>No hay próximos gastos en {currency}.</p></div>
          <Link className="secondary-button" href="/expenses/new">Registrar gasto</Link>
        </div>
      )}
    </section>
  );
}
