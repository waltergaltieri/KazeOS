"use client";

import { LoaderCircle, Pause } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import {
  cancelRecurringExpenseAction,
  pauseRecurringExpenseAction,
  type RecurringExpenseActionState,
} from "@/lib/actions/recurring-expenses";

const initial: RecurringExpenseActionState = { status: "idle" };

type Feedback = { kind: "error" | "success"; message: string } | null;

interface RecurringExpenseLifecycleControlProps {
  recurringExpenseId: string;
  title: string;
  status: "active" | "paused" | "cancelled";
}

export function RecurringExpenseLifecycleControl({
  recurringExpenseId,
  title,
  status,
}: RecurringExpenseLifecycleControlProps) {
  const [confirmingCancellation, setConfirmingCancellation] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pauseState, pauseAction, pausing] = useActionState(pauseRecurringExpenseAction, initial);
  const [cancelState, cancelAction, cancelling] = useActionState(cancelRecurringExpenseAction, initial);
  const pauseSubmitted = useRef(false);
  const cancelSubmitted = useRef(false);
  const cancelOpener = useRef<HTMLButtonElement>(null);
  const cancelConfirmation = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (confirmingCancellation) cancelConfirmation.current?.focus();
  }, [confirmingCancellation]);

  useEffect(() => {
    if (!pauseSubmitted.current || pausing || pauseState.status === "idle") return;
    requestAnimationFrame(() => {
      pauseSubmitted.current = false;
      if (pauseState.status === "success") {
        setFeedback({ kind: "success", message: "Recurrencia pausada." });
        router.refresh();
        return;
      }
      setFeedback({
        kind: "error",
        message: pauseState.message ?? "No pudimos pausar la recurrencia.",
      });
    });
  }, [pauseState, pausing, router]);

  useEffect(() => {
    if (!cancelSubmitted.current || cancelling || cancelState.status === "idle") return;
    requestAnimationFrame(() => {
      cancelSubmitted.current = false;
      setConfirmingCancellation(false);
      cancelOpener.current?.focus();
      if (cancelState.status === "success") {
        setFeedback({ kind: "success", message: "Recurrencia cancelada." });
        router.refresh();
        return;
      }
      setFeedback({
        kind: "error",
        message: cancelState.message ?? "No pudimos cancelar la recurrencia.",
      });
    });
  }, [cancelState, cancelling, router]);

  if (status === "cancelled") return null;

  function dismissCancellation() {
    setConfirmingCancellation(false);
    requestAnimationFrame(() => cancelOpener.current?.focus());
  }

  return (
    <div className="recurring-lifecycle-control" aria-busy={pausing || cancelling || undefined}>
      <div className="recurring-lifecycle-actions" hidden={confirmingCancellation}>
          {status === "active" ? (
            <form
              action={pauseAction}
              onSubmit={() => {
                pauseSubmitted.current = true;
                setFeedback(null);
              }}
            >
              <input type="hidden" name="recurringExpenseId" value={recurringExpenseId} />
              <button
                className="quiet-button"
                type="submit"
                disabled={pausing || cancelling}
                aria-label={`Pausar recurrencia ${title}`}
              >
                {pausing ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
                {pausing ? "Pausando…" : "Pausar"}
              </button>
            </form>
          ) : null}
          <button
            ref={cancelOpener}
            className="quiet-button recurring-lifecycle-cancel"
            type="button"
            disabled={pausing || cancelling}
            aria-label={`Cancelar recurrencia ${title}`}
            onClick={() => {
              setFeedback(null);
              setConfirmingCancellation(true);
            }}
          >
            Cancelar
          </button>
      </div>
      {confirmingCancellation ? (
        <form
          action={cancelAction}
          onSubmit={() => { cancelSubmitted.current = true; }}
          className="recurring-lifecycle-confirm"
          role="group"
          aria-label={`Confirmar cancelación de ${title}`}
        >
          <input type="hidden" name="recurringExpenseId" value={recurringExpenseId} />
          <span>La cancelación es definitiva. Conserva el historial y detiene futuras proyecciones.</span>
          <button className="quiet-button" type="button" disabled={cancelling} onClick={dismissCancellation}>Volver</button>
          <button ref={cancelConfirmation} className="danger-button" type="submit" disabled={cancelling}>
            {cancelling ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}
            {cancelling ? "Cancelando…" : "Confirmar cancelación"}
          </button>
        </form>
      ) : null}
      {pausing ? <small role="status">Pausando recurrencia…</small> : null}
      {cancelling ? <small role="status">Cancelando recurrencia…</small> : null}
      {!pausing && !cancelling && feedback ? (
        <small
          className={feedback.kind === "error" ? "field-error" : "recurring-lifecycle-success"}
          role={feedback.kind === "error" ? "alert" : "status"}
        >
          {feedback.message}
        </small>
      ) : null}
    </div>
  );
}
