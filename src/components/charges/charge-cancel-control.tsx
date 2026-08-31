"use client";

import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { cancelChargeAction, type ChargeActionState } from "@/lib/actions/charges";

const initial: ChargeActionState = { status: "idle" };

export function ChargeCancelControl({ chargeId }: { chargeId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState(cancelChargeAction, initial);
  const opener = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (confirming) confirm.current?.focus();
  }, [confirming]);
  useEffect(() => {
    if (state.status !== "success") return;
    router.replace(state.clientId ? `/clients/${state.clientId}/charges` : "/charges");
    router.refresh();
  }, [router, state]);

  function dismiss() {
    setConfirming(false);
    requestAnimationFrame(() => opener.current?.focus());
  }

  return (
    <div className="charge-cancel-control">
      <button
        ref={opener}
        className="danger-button"
        type="button"
        hidden={confirming}
        onClick={() => setConfirming(true)}
      >
        Cancelar cobro
      </button>
      {confirming ? (
        <form
          action={action}
          className="charge-cancel-confirm"
          role="group"
          aria-label="Confirmar cancelación"
        >
          <input type="hidden" name="chargeId" value={chargeId} />
          <span>Se conserva el asiento, marcado como cancelado.</span>
          <button className="quiet-button" type="button" onClick={dismiss}>
            Volver
          </button>
          <button ref={confirm} className="danger-button" type="submit" disabled={pending}>
            {pending ? <LoaderCircle className="spin" size={15} /> : null}
            Confirmar cancelación
          </button>
          {state.status === "error" ? <small className="field-error" role="alert">{state.message}</small> : null}
        </form>
      ) : null}
    </div>
  );
}
