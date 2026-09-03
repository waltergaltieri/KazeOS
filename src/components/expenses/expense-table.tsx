"use client";

import { CircleDollarSign, Copy, Pencil, Repeat2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { formatMoney } from "@/lib/domain/money";
import type { ExpenseListItem } from "@/lib/queries/expenses";
import { ExpenseCancelControl } from "./expense-cancel-control";
import { ExpensePaymentDialog } from "./expense-payment-dialog";
import { ExpenseStatusBadge } from "./expense-status-badge";

const scopeLabels: Record<ExpenseListItem["scope"], string> = {
  business: "Negocio",
  personal: "Personal",
  family: "Familia",
  friends: "Amigos",
  partner: "Pareja",
  other: "Otro",
};
const costTypeLabels: Record<ExpenseListItem["costType"], string> = {
  fixed: "Fijo",
  variable: "Variable",
};

function shortDate(value: string) {
  return value.split("-").reverse().join("/");
}

function operational(expense: ExpenseListItem) {
  return expense.persistedStatus === "planned" || expense.persistedStatus === "pending";
}

function compareExpenses(left: ExpenseListItem, right: ExpenseListItem) {
  const leftPriority = left.status === "overdue" ? 0 : operational(left) ? 1 : 2;
  const rightPriority = right.status === "overdue" ? 0 : operational(right) ? 1 : 2;
  return leftPriority - rightPriority || left.dueDate.localeCompare(right.dueDate) || left.id.localeCompare(right.id);
}

function EditAction({ expense, compact = false }: { expense: ExpenseListItem; compact?: boolean }) {
  if (expense.recurringExpense) {
    return <Link className={compact ? "icon-button" : "secondary-button"} href={`/expenses/recurring/${expense.recurringExpense.id}/edit`} aria-label={`Editar recurrencia de ${expense.title}`}><Repeat2 size={15} /><span className={compact ? "sr-only" : undefined}>Recurrencia</span></Link>;
  }
  if (!operational(expense)) return null;
  if (expense.generatedAutomatically) return null;
  return <Link className={compact ? "icon-button" : "secondary-button"} href={`/expenses/${expense.id}/edit`} aria-label={`Editar gasto ${expense.title}`}><Pencil size={15} /><span className={compact ? "sr-only" : undefined}>Editar</span></Link>;
}

function DuplicateAction({ expense, compact = false }: { expense: ExpenseListItem; compact?: boolean }) {
  return <Link className={compact ? "icon-button" : "secondary-button"} href={`/expenses/new?duplicate=${expense.id}`} aria-label={`Duplicar gasto ${expense.title}`}><Copy size={15} /><span className={compact ? "sr-only" : undefined}>Duplicar</span></Link>;
}

function PaymentAction({ expense, onOpen, compact = false }: { expense: ExpenseListItem; onOpen: (correction: boolean) => void; compact?: boolean }) {
  if (expense.status === "cancelled") return null;
  const correction = expense.status === "paid";
  return <button className={`primary-button${compact ? " primary-button--compact" : ""}`} type="button" aria-label={`${correction ? "Corregir pago" : "Registrar pago"} de ${expense.title}`} onClick={() => onOpen(correction)}>{correction ? "Corregir" : compact ? "Pagar" : "Registrar pago"}</button>;
}

function Classification({ expense }: { expense: ExpenseListItem }) {
  return <div className="expense-classification"><span className="expense-classification--scope">{scopeLabels[expense.scope]}</span><span className="expense-classification--type">{costTypeLabels[expense.costType]}</span>{expense.recurringExpense ? <span className="expense-classification--recurring">Recurrente</span> : null}</div>;
}

export function ExpenseTable({ expenses, today }: { expenses: ExpenseListItem[]; today: string }) {
  const [paying, setPaying] = useState<{ expense: ExpenseListItem; correction: boolean } | null>(null);
  if (!expenses.length) {
    return <section className="expense-empty"><CircleDollarSign size={24} aria-hidden="true" /><div><h2>No hay gastos para esta vista</h2><p>Cambiá los filtros o registrá una obligación.</p></div><Link className="primary-button" href="/expenses/new">Nuevo gasto</Link></section>;
  }

  const ordered = [...expenses].sort(compareExpenses);
  return (
    <>
      <section className="expense-ledger" aria-label="Libro de gastos">
        <div className="expense-table-wrap">
          <table className="expense-table">
            <thead><tr><th>Gasto / proveedor</th><th>Categoría</th><th>Ámbito</th><th>Tipo</th><th>Vencimiento</th><th>Estado</th><th className="align-end">Importe</th><th><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody>{ordered.map((expense) => {
              const canCommand = operational(expense);
              return <tr key={expense.id} className={`expense-row expense-row--${expense.status}`}>
                <td><strong>{expense.title}</strong><small>{expense.vendor ?? expense.description ?? "Sin proveedor"}</small></td>
                <td><div className="expense-table-classification"><span className="expense-category">{expense.category.icon ? <span aria-hidden="true">{expense.category.icon}</span> : null}{expense.category.name}</span>{expense.recurringExpense ? <span className="expense-dimension expense-dimension--recurring">Recurrente</span> : null}</div></td>
                <td><span className="expense-dimension expense-dimension--scope">{scopeLabels[expense.scope]}</span></td>
                <td><span className="expense-dimension expense-dimension--type">{costTypeLabels[expense.costType]}</span></td>
                <td><time dateTime={expense.dueDate}>{shortDate(expense.dueDate)}</time></td>
                <td><ExpenseStatusBadge status={expense.status} /></td>
                <td className="align-end money-data">{formatMoney(expense.amountMinor, expense.currency)}</td>
                <td className="expense-actions">
                  <PaymentAction expense={expense} compact onOpen={(correction) => setPaying({ expense, correction })} />
                  <EditAction expense={expense} compact />
                  <DuplicateAction expense={expense} compact />
                  {canCommand ? <ExpenseCancelControl expenseId={expense.id} title={expense.title} allowDelete={!expense.generatedAutomatically && !expense.recurringExpense} /> : null}
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div>

        <div className="expense-card-list">
          {ordered.map((expense) => {
            const canCommand = operational(expense);
            return <article className={`expense-card expense-card--${expense.status}`} key={expense.id}>
              <header><div><strong>{expense.title}</strong><span>{expense.vendor ?? expense.description ?? "Sin proveedor"}</span></div><ExpenseStatusBadge status={expense.status} /></header>
              <div className="expense-card__amount"><span>Importe</span><strong className="money-data">{formatMoney(expense.amountMinor, expense.currency)}</strong></div>
              <dl><div><dt>Vence</dt><dd><time dateTime={expense.dueDate}>{shortDate(expense.dueDate)}</time></dd></div><div><dt>Categoría</dt><dd>{expense.category.name}</dd></div></dl>
              <Classification expense={expense} />
              <footer>
                <PaymentAction expense={expense} onOpen={(correction) => setPaying({ expense, correction })} />
                <EditAction expense={expense} />
                <DuplicateAction expense={expense} />
                {canCommand ? <ExpenseCancelControl expenseId={expense.id} title={expense.title} allowDelete={!expense.generatedAutomatically && !expense.recurringExpense} /> : null}
              </footer>
            </article>;
          })}
        </div>
      </section>
      {paying ? <ExpensePaymentDialog expense={paying.expense} today={today} correction={paying.correction} open onClose={() => setPaying(null)} /> : null}
    </>
  );
}
