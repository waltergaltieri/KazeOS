"use client";
import { LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { ChargeActionState } from "@/lib/actions/charges";
import { CurrencyAmountInput } from "@/components/ui/currency-amount-input";
import { LedgerSelect } from "@/components/ui/ledger-select";
import { MiniDatePicker } from "@/components/ui/mini-date-picker";
import { ChargeCancelControl } from "./charge-cancel-control";
type Action = (state: ChargeActionState, data: FormData) => Promise<ChargeActionState>;
type ClientOption = { id: string; displayName: string };
type ChargeDefaults = { description: string; amountMinor: number; currency: "USD" | "ARS"; dueDate: string };
const initial: ChargeActionState = { status: "idle" };
function amountValue(minor: number) { return `${Math.floor(minor / 100)},${String(minor % 100).padStart(2, "0")}`; }
export function ChargeForm({ action, clients, selectedClientId, mode = "create", chargeId, defaults, defaultCurrency = "USD" }: { action: Action; clients: ClientOption[]; selectedClientId?: string; mode?: "create" | "edit"; chargeId?: string; defaults?: ChargeDefaults; defaultCurrency?: "USD" | "ARS" }) {
  const [state, formAction, pending] = useActionState(action, initial); const router = useRouter();
  const [currency, setCurrency] = useState<"USD" | "ARS">(defaults?.currency ?? defaultCurrency);
  useEffect(() => { if (state.status === "success") router.replace(state.clientId ? `/clients/${state.clientId}/charges` : "/charges"); }, [router, state]);
  const error = (name: string) => state.fieldErrors?.[name]?.[0];
  const selectedClient = clients.find((client) => client.id === selectedClientId);
  return <div className="charge-editor-stack"><form action={formAction} className="charge-form" noValidate>{chargeId ? <input type="hidden" name="chargeId" value={chargeId} /> : null}<section className="form-sheet"><header className="form-sheet__heading"><span>01</span><div><h2>Obligación manual</h2><p>Cliente, concepto, importe y vencimiento en un solo asiento.</p></div></header><div className="form-grid form-grid--two">
    <label className="field-stack"><span>Cliente *</span>{mode === "edit" ? <><span className="form-control form-control--locked">{selectedClient?.displayName}</span><input type="hidden" name="clientId" value={selectedClientId} /></> : <LedgerSelect name="clientId" label="Cliente" defaultValue={selectedClientId} required error={error("clientId")} options={clients.map((client) => ({ value: client.id, label: client.displayName }))} />}{error("clientId") ? <small className="field-error">{error("clientId")}</small> : null}</label>
    <label className="field-stack"><span>Concepto *</span><input className="form-control" name="description" required defaultValue={defaults?.description} aria-invalid={Boolean(error("description"))} />{error("description") ? <small className="field-error">{error("description")}</small> : null}</label>
    <label className="field-stack"><span>Monto *</span><CurrencyAmountInput currency={currency} defaultValue={defaults ? amountValue(defaults.amountMinor) : undefined} error={error("amount")} /></label>
    <label className="field-stack"><span>Moneda</span><LedgerSelect name="currency" label="Moneda" defaultValue={currency} onValueChange={(value) => setCurrency(value as "USD" | "ARS")} options={[{ value: "USD", label: "USD" }, { value: "ARS", label: "ARS" }]} /></label>
    <div className="field-stack"><span>Vencimiento *</span><MiniDatePicker defaultValue={defaults?.dueDate} error={error("dueDate")} /></div>
    <input type="hidden" name="notes" value="" />
  </div></section>{state.status === "error" ? <p className="form-error" role="alert">{state.message}</p> : null}<footer className="client-form__actions"><button className="primary-button" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />} {pending ? "Guardando…" : mode === "edit" ? "Guardar cambios" : "Guardar cobro"}</button></footer></form>{mode === "edit" && chargeId ? <ChargeCancelControl chargeId={chargeId} /> : null}</div>;
}
