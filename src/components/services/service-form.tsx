"use client";

import { CalendarClock, LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import type { ServiceActionState } from "@/lib/actions/services";

type ServiceFormAction = (
  state: ServiceActionState,
  formData: FormData,
) => Promise<ServiceActionState>;

export interface ServiceDefaults {
  id?: string;
  name?: string;
  description?: string | null;
  amountMinor?: number;
  currency?: "USD" | "ARS";
  billingType?: "recurring" | "one_time";
  billingFrequency?: "monthly" | "quarterly" | "yearly" | "one_time";
  billingDay?: number | null;
  startDate?: string;
  endDate?: string | null;
  status?: "active" | "paused" | "cancelled";
  automaticChargeGeneration?: boolean;
}

const initialState: ServiceActionState = { status: "idle" };

function amountInputValue(amountMinor?: number) {
  if (amountMinor === undefined) return "";
  const value = BigInt(amountMinor);
  const minorUnitScale = BigInt(100);
  return `${value / minorUnitScale},${(value % minorUnitScale)
    .toString()
    .padStart(2, "0")}`;
}

export function ServiceForm({
  action,
  clientId,
  currencyLocked = false,
  defaults = {},
}: {
  action: ServiceFormAction;
  clientId: string;
  currencyLocked?: boolean;
  defaults?: ServiceDefaults;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialState);
  const [billingType, setBillingType] = useState(defaults.billingType ?? "recurring");
  const [automatic, setAutomatic] = useState(
    defaults.automaticChargeGeneration ?? true,
  );
  const recurring = billingType === "recurring";
  const error = (field: string) => state.fieldErrors?.[field]?.[0];
  const currency = defaults.currency ?? "USD";
  const editing = Boolean(defaults.id);
  const cancelled = defaults.status === "cancelled";

  useEffect(() => {
    if (state.status === "success" && state.clientId) {
      router.replace(`/clients/${state.clientId}/services`);
    }
  }, [router, state]);

  return (
    <form action={formAction} className="service-form" noValidate>
      <input type="hidden" name="clientId" value={clientId} />
      {defaults.id ? <input type="hidden" name="serviceId" value={defaults.id} /> : null}

      <section className="form-sheet service-contract" aria-labelledby="service-identity-heading">
        <header className="form-sheet__heading">
          <span>01</span>
          <div>
            <h2 id="service-identity-heading">Acuerdo</h2>
            <p>Qué se presta y cuál es su valor pactado.</p>
          </div>
        </header>
        <div className="form-grid form-grid--two">
          <Field label="Nombre del servicio" name="name" required error={error("name")} defaultValue={defaults.name} />
          <Field label="Monto" name="amount" required inputMode="decimal" error={error("amount")} defaultValue={amountInputValue(defaults.amountMinor)} prefix={currency} />
          <div className="field-stack">
            <label htmlFor="service-currency">Moneda</label>
            <select id="service-currency" className="form-control" name="currency" defaultValue={currency} disabled={currencyLocked} aria-describedby={currencyLocked ? "currency-lock-note" : error("currency") ? "currency-error" : undefined} aria-invalid={Boolean(error("currency"))}>
              <option value="USD">USD</option>
              <option value="ARS">ARS</option>
            </select>
            {currencyLocked ? <small id="currency-lock-note" className="field-note">La moneda queda protegida porque ya existen cargos vinculados.</small> : null}
            {error("currency") ? <small id="currency-error" className="field-error">{error("currency")}</small> : null}
          </div>
          {currencyLocked ? <input type="hidden" name="currency" value={currency} /> : null}
          <label className="field-stack service-description-field">
            <span>Descripción</span>
            <textarea className="form-control form-textarea" name="description" defaultValue={defaults.description ?? ""} aria-invalid={Boolean(error("description"))} aria-describedby={error("description") ? "description-error" : undefined} />
            {error("description") ? <small id="description-error" className="field-error">{error("description")}</small> : null}
          </label>
        </div>
      </section>

      <section className="form-sheet service-contract" aria-labelledby="service-calendar-heading">
        <header className="form-sheet__heading">
          <span><CalendarClock size={15} aria-hidden="true" /></span>
          <div>
            <h2 id="service-calendar-heading">Regla de cobro</h2>
            <p>El calendario que proyecta obligaciones sin duplicarlas.</p>
          </div>
        </header>
        <div className="form-grid form-grid--three">
          <label className="field-stack">
            <span>Modalidad</span>
            <select className="form-control" name="billingType" value={billingType} onChange={(event) => setBillingType(event.target.value as "recurring" | "one_time")}>
              <option value="recurring">Recurrente</option>
              <option value="one_time">Único</option>
            </select>
          </label>
          <label className="field-stack">
            <span>Frecuencia</span>
            <select aria-label="Frecuencia" className="form-control" name={recurring ? "billingFrequency" : undefined} defaultValue={recurring ? defaults.billingFrequency ?? "monthly" : "one_time"} disabled={!recurring} aria-invalid={Boolean(error("billingFrequency"))}>
              {recurring ? <>
                <option value="monthly">Mensual</option>
                <option value="quarterly">Trimestral</option>
                <option value="yearly">Anual</option>
              </> : <option value="one_time">Único</option>}
            </select>
            {!recurring ? <input type="hidden" name="billingFrequency" value="one_time" /> : null}
            {error("billingFrequency") ? <small className="field-error">{error("billingFrequency")}</small> : null}
          </label>
          <Field label="Día de cobro" name="billingDay" type="number" min="1" max="31" disabled={!recurring} required={recurring} error={error("billingDay")} defaultValue={defaults.billingDay?.toString()} />
          <Field label="Inicio" name="startDate" type="date" required error={error("startDate")} defaultValue={defaults.startDate} />
          <Field label="Fin opcional" name="endDate" type="date" error={error("endDate")} defaultValue={defaults.endDate} />
          <div className="field-stack">
            <label htmlFor="service-status">Estado</label>
            <select id="service-status" className="form-control" name="status" defaultValue={defaults.status ?? "active"} disabled={cancelled} aria-describedby={editing ? "service-status-note" : undefined}>
              <option value="active">Activo</option>
              <option value="paused">En pausa</option>
              {editing ? <option value="cancelled">Cancelado</option> : null}
            </select>
            {cancelled ? <input type="hidden" name="status" value="cancelled" /> : null}
            {editing ? (
              <small id="service-status-note" className="field-note">
                {cancelled
                  ? "Este servicio cancelado no se puede reactivar."
                  : "Pausar conserva los cargos ya proyectados. Cancelar es definitivo y sólo anula proyecciones futuras elegibles."}
              </small>
            ) : null}
          </div>
        </div>
        <label className={`automation-switch${recurring ? "" : " is-disabled"}`}>
          <input type="checkbox" name="automaticChargeGeneration" aria-label="Generar cargos automáticamente" checked={recurring && automatic} onChange={(event) => setAutomatic(event.target.checked)} disabled={!recurring} />
          <span><strong>Generar cargos automáticamente</strong><small>Proyecta tres meses y evita períodos duplicados.</small></span>
        </label>
      </section>

      {state.status === "error" && state.message ? <p className="form-error" role="alert">{state.message}</p> : null}
      <footer className="client-form__actions">
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}
          {pending ? "Guardando…" : "Guardar servicio"}
        </button>
      </footer>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  required,
  disabled,
  error,
  defaultValue,
  inputMode,
  min,
  max,
  prefix,
}: {
  label: string;
  name: string;
  type?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  defaultValue?: string | null;
  inputMode?: "decimal";
  min?: string;
  max?: string;
  prefix?: string;
}) {
  const errorId = `${name}-error`;
  return (
    <label className="field-stack">
      <span>{label}{required ? " *" : ""}</span>
      <span className={prefix ? "money-control" : undefined} data-prefix={prefix}>
        <input className="form-control" name={name} type={type} required={required} disabled={disabled} defaultValue={defaultValue ?? ""} inputMode={inputMode} min={min} max={max} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} />
      </span>
      {error ? <small id={errorId} className="field-error">{error}</small> : null}
    </label>
  );
}
