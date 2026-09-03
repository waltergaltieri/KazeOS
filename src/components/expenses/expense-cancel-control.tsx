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
  const [feedback, setFeedback] = useState<string | null>(null);
  const [cancelState, cancelAction, cancelling] = useActionState(cancelExpenseAction, initial);
  const [deleteState, deleteAction, deleting] = useActionState(deleteExpenseAction, initial);
  const opener = useRef<HTMLElement | null>(null);
  const submitted = useRef<Command>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const pending = command === "delete" ? deleting : cancelling;

  useEffect(() => {
    if (command) confirm.current?.focus();
  }, [command]);
  useEffect(() => {
    const submittedCommand = submitted.current;
    if (!submittedCommand) return;
    const submittedState = submittedCommand === "delete" ? deleteState : cancelState;
    const submittedPending = submittedCommand === "delete" ? deleting : cancelling;
    if (submittedPending || submittedState.status === "idle") return;

    submitted.current = null;
    setFeedback(submittedState.status === "error" ? submittedState.message ?? "No pudimos completar la acción." : null);
    setCommand(null);
    requestAnimationFrame(() => opener.current?.focus());
    if (submittedState.status === "success") router.refresh();
  }, [cancelState, cancelling, deleteState, deleting, router]);

  function begin(nextCommand: Exclude<Command, null>, target: HTMLElement) {
    opener.current = target;
    setFeedback(null);
    setCommand(nextCommand);
  }

  function dismiss() {
    setCommand(null);
    requestAnimationFrame(() => opener.current?.focus());
  }

  const deletingExpense = command === "delete";
  return (
    <>
      <div className="expense-command-actions" hidden={Boolean(command)}>
        <button className="quiet-button" type="button" aria-label={`Cancelar gasto ${title}`} onClick={(event) => begin("cancel", event.currentTarget)}>Cancelar</button>
        {allowDelete ? <button className="quiet-button expense-delete-button" type="button" aria-label={`Eliminar gasto ${title}`} onClick={(event) => begin("delete", event.currentTarget)}>Eliminar</button> : null}
      </div>
      {command ? <form action={deletingExpense ? deleteAction : cancelAction} onSubmit={() => { submitted.current = command; }} className="expense-command-confirm" role="group" aria-label={deletingExpense ? `Confirmar eliminación de ${title}` : `Confirmar cancelación de ${title}`}>
        <input type="hidden" name="expenseId" value={expenseId} />
        <span>{deletingExpense ? "Se eliminará este asiento manual." : "Se conserva el asiento fuera de los totales."}</span>
        <button className="quiet-button" type="button" onClick={dismiss}>Volver</button>
        <button ref={confirm} className="danger-button" type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="spin" size={14} /> : null}
          {deletingExpense ? "Confirmar eliminación" : "Confirmar cancelación"}
        </button>
      </form> : null}
      {!command && feedback ? <small className="field-error expense-command-feedback" role="alert">{feedback}</small> : null}
    </>
  );
}
