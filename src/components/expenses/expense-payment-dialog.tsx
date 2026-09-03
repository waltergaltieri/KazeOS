"use client";

import { LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { LedgerSelect } from "@/components/ui/ledger-select";
import {
  correctPaidExpenseAction,
  markExpensePaidAction,
  type ExpenseActionState,
} from "@/lib/actions/expenses";
import { formatMoney } from "@/lib/domain/money";
import type { ExpenseListItem } from "@/lib/queries/expenses";

const initial: ExpenseActionState = { status: "idle" };
const methods = [
  { value: "bank_transfer", label: "Transferencia" },
  { value: "cash", label: "Efectivo" },
  { value: "mercadopago", label: "Mercado Pago" },
  { value: "paypal", label: "PayPal" },
  { value: "payoneer", label: "Payoneer" },
  { value: "stripe", label: "Stripe" },
  { value: "crypto", label: "Cripto" },
  { value: "debit_card", label: "Tarjeta de débito" },
  { value: "credit_card", label: "Tarjeta de crédito" },
  { value: "other", label: "Otro" },
];

function amountValue(minor: number) {
  return `${Math.floor(minor / 100)},${String(minor % 100).padStart(2, "0")}`;
}

export interface PayableExpense {
  id: string;
  title: string;
  amountMinor: number;
  currency: "USD" | "ARS";
  paidDate: string | null;
  paymentMethod: ExpenseListItem["paymentMethod"];
}

export function ExpensePaymentDialog({
  expense,
  today,
  correction = false,
  open,
  onClose,
}: {
  expense: PayableExpense;
  today: string;
  correction?: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(
    correction ? correctPaidExpenseAction : markExpensePaidAction,
    initial,
  );
  const [amount, setAmount] = useState(amountValue(expense.amountMinor));
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const titleId = useId();
  const descriptionId = useId();
  const paidDateErrorId = useId();

  useEffect(() => {
    const target = opener.current;
    return () => {
      requestAnimationFrame(() => {
        if (target?.isConnected) target.focus();
      });
    };
  }, []);

  useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) {
      if (typeof node.showModal === "function") node.showModal();
      else node.setAttribute("open", "");
    }
    else if (!open && node?.open) node.close();
  }, [open]);

  useEffect(() => {
    if (state.status !== "success") return;
    router.refresh();
    onClose();
  }, [onClose, router, state.status]);

  function close() {
    if (dialog.current?.open) dialog.current.close();
    else onClose();
  }

  const verb = correction ? "Corregir" : "Registrar";
  const context = `Importe final ${formatMoney(expense.amountMinor, expense.currency)}.`;

  return (
    <dialog
      ref={dialog}
      className="expense-payment-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClose={onClose}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        close();
      }}
    >
      <header>
        <div>
          <p className="eyebrow">{correction ? "Corrección controlada" : "Cerrar obligación"}</p>
          <h2 id={titleId}>{verb} pago de {expense.title}</h2>
          <p aria-hidden="true">{context}</p>
          <p id={descriptionId} className="sr-only">{context}</p>
        </div>
        <button className="icon-button" type="button" aria-label={`Cerrar ${correction ? "corrección" : "registro"} de pago`} onClick={close}><X size={18} /></button>
      </header>
      <form action={action} className="expense-payment-form">
        <input type="hidden" name="expenseId" value={expense.id} />
        <label className="field-stack">
          <span>Monto final</span>
          <input autoFocus className="form-control money-data" name="amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} aria-invalid={Boolean(state.fieldErrors?.amount) || undefined} />
          {state.fieldErrors?.amount?.[0] ? <small className="field-error">{state.fieldErrors.amount[0]}</small> : null}
        </label>
        <div className="form-grid form-grid--two">
          <label className="field-stack">
            <span>Fecha de pago</span>
            <input className="form-control" name="paidDate" inputMode="numeric" placeholder="AAAA-MM-DD" defaultValue={expense.paidDate ?? today} aria-invalid={Boolean(state.fieldErrors?.paidDate) || undefined} aria-describedby={state.fieldErrors?.paidDate?.[0] ? paidDateErrorId : undefined} />
            {state.fieldErrors?.paidDate?.[0] ? <small id={paidDateErrorId} className="field-error">{state.fieldErrors.paidDate[0]}</small> : null}
          </label>
          <label className="field-stack">
            <span>Método</span>
            <LedgerSelect name="paymentMethod" label="Método de pago" defaultValue={expense.paymentMethod ?? "bank_transfer"} options={methods} error={state.fieldErrors?.paymentMethod?.[0]} />
          </label>
        </div>
        {state.status === "error" ? <p className="form-error" role="alert">{state.message}</p> : null}
        <footer>
          <button className="quiet-button" type="button" onClick={close}>Volver</button>
          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? <LoaderCircle className="spin" size={16} /> : null}
            {correction ? "Guardar corrección" : "Registrar pago"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
