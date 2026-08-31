"use client";
import { LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import type { ChargeActionState } from "@/lib/actions/charges";
import { LedgerSelect } from "@/components/ui/ledger-select";
type Action = (state: ChargeActionState, data: FormData) => Promise<ChargeActionState>;
type ClientOption = { id: string; displayName: string };
const initial: ChargeActionState = { status: "idle" };
export function ChargeForm({ action, clients, selectedClientId }: { action: Action; clients: ClientOption[]; selectedClientId?: string }) {
  const [state, formAction, pending] = useActionState(action, initial); const router = useRouter();
  useEffect(() => { if (state.status === "success") router.replace(state.clientId ? `/clients/${state.clientId}/charges` : "/charges"); }, [router, state]);
  const error = (name: string) => state.fieldErrors?.[name]?.[0];
  return <form action={formAction} className="charge-form" noValidate><section className="form-sheet"><header className="form-sheet__heading"><span>01</span><div><h2>Obligación manual</h2><p>Cliente, concepto, importe y vencimiento en un solo asiento.</p></div></header><div className="form-grid form-grid--two">
    <label className="field-stack"><span>Cliente *</span><LedgerSelect name="clientId" label="Cliente" defaultValue={selectedClientId} required options={clients.map((client) => ({ value: client.id, label: client.displayName }))} />{error("clientId") ? <small className="field-error">{error("clientId")}</small> : null}</label>
    <label className="field-stack"><span>Concepto *</span><input className="form-control" name="description" required aria-invalid={Boolean(error("description"))} />{error("description") ? <small className="field-error">{error("description")}</small> : null}</label>
    <label className="field-stack"><span>Monto *</span><input className="form-control" name="amount" inputMode="decimal" required aria-invalid={Boolean(error("amount"))} />{error("amount") ? <small className="field-error">{error("amount")}</small> : null}</label>
    <label className="field-stack"><span>Moneda</span><LedgerSelect name="currency" label="Moneda" defaultValue="USD" options={[{ value: "USD", label: "USD" }, { value: "ARS", label: "ARS" }]} /></label>
    <label className="field-stack"><span>Vencimiento *</span><input className="form-control" type="text" inputMode="numeric" placeholder="AAAA-MM-DD" name="dueDate" required aria-invalid={Boolean(error("dueDate"))} />{error("dueDate") ? <small className="field-error">{error("dueDate")}</small> : null}</label>
    <input type="hidden" name="notes" value="" />
  </div></section>{state.status === "error" ? <p className="form-error" role="alert">{state.message}</p> : null}<footer className="client-form__actions"><button className="primary-button" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} {pending ? "Guardando…" : "Guardar cobro"}</button></footer></form>;
}
