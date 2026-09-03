"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import {
  cancelExpenseAction,
  deleteExpenseAction,
  type ExpenseActionState,
} from "@/lib/actions/expenses";

const initial: ExpenseActionState = { status: "idle" };
type Command = "cancel" | "delete" | null;

export function ExpenseCancelControl({ expenseId, title, allowDelete }: { expenseId: string; title: string; allowDelete: boolean }) {
  const [command, setCommand] = useState<Command>(null);
  const [cancelState, cancelAction, cancelling] = useActionState(cancelExpenseAction, initial);
  const [deleteState, deleteAction, deleting] = useActionState(deleteExpenseAction, initial);
  const cancelOpener = useRef<HTMLButtonElement>(null);
  const deleteOpener = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const state = command === "delete" ? deleteState : cancelState;
  const pending = command === "delete" ? deleting : cancelling;

  useEffect(() => {
    if (command) confirm.current?.focus();
  }, [command]);
  useEffect(() => {
    if (cancelState.status === "success" || deleteState.status === "success") router.refresh();
  }, [cancelState.status, deleteState.status, router]);

  function dismiss() {
    const target = command === "delete" ? deleteOpener.current : cancelOpener.current;
    setCommand(null);
    requestAnimationFrame(() => target?.focus());
  }

  if (command) {
    const deletingExpense = command === "delete";
    return (
      <form action={deletingExpense ? deleteAction : cancelAction} className="expense-command-confirm" role="group" aria-label={deletingExpense ? `Confirmar eliminación de ${title}` : `Confirmar cancelación de ${title}`}>
        <input type="hidden" name="expenseId" value={expenseId} />
        <span>{deletingExpense ? "Se eliminará este asiento manual." : "Se conserva el asiento fuera de los totales."}</span>
        <button className="quiet-button" type="button" onClick={dismiss}>Volver</button>
        <button ref={confirm} className="danger-button" type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="spin" size={14} /> : null}
          {deletingExpense ? "Confirmar eliminación" : "Confirmar cancelación"}
        </button>
        {state.status === "error" ? <small className="field-error" role="alert">{state.message}</small> : null}
      </form>
    );
  }

  return (
    <div className="expense-command-actions">
      <button ref={cancelOpener} className="quiet-button" type="button" aria-label={`Cancelar gasto ${title}`} onClick={() => setCommand("cancel")}>Cancelar</button>
      {allowDelete ? <button ref={deleteOpener} className="quiet-button expense-delete-button" type="button" aria-label={`Eliminar gasto ${title}`} onClick={() => setCommand("delete")}>Eliminar</button> : null}
    </div>
  );
}
