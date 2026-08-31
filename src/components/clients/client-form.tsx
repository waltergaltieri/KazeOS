"use client";

import { LoaderCircle, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import type { ClientActionState } from "@/lib/actions/clients";

type ClientFormAction = (
  state: ClientActionState,
  formData: FormData,
) => Promise<ClientActionState>;

type ClientDefaults = {
  id?: string;
  firstName?: string;
  lastName?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  taxId?: string | null;
  website?: string | null;
  address?: string | null;
  notes?: string | null;
  status?: "active" | "paused" | "archived";
};

const initialState: ClientActionState = { status: "idle" };

export function ClientForm({ action, defaults = {} }: { action: ClientFormAction; defaults?: ClientDefaults }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.status === "success" && state.clientId) {
      router.replace(`/clients/${state.clientId}`);
    }
  }, [router, state]);

  const error = (field: string) => state.fieldErrors?.[field]?.[0];

  return (
    <form action={formAction} className="client-form" noValidate>
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <section className="form-sheet" aria-labelledby="identity-heading">
        <header className="form-sheet__heading">
          <span>01</span>
          <div><h2 id="identity-heading">Identidad</h2><p>Los datos mínimos para reconocer el legajo.</p></div>
        </header>
        <div className="form-grid form-grid--three">
          <Field label="Nombre" name="firstName" required error={error("firstName")} defaultValue={defaults.firstName} />
          <Field label="Apellido" name="lastName" error={error("lastName")} defaultValue={defaults.lastName} />
          <Field label="Empresa" name="company" error={error("company")} defaultValue={defaults.company} />
          <label className="field-stack">
            <span>Estado</span>
            <select name="status" defaultValue={defaults.status ?? "active"} className="form-control">
              <option value="active">Activo</option>
              <option value="paused">En pausa</option>
              <option value="archived">Archivado</option>
            </select>
          </label>
        </div>
      </section>

      <section className="form-sheet" aria-labelledby="contact-heading">
        <header className="form-sheet__heading">
          <span>02</span>
          <div><h2 id="contact-heading">Contacto</h2><p>Canales de trabajo y referencia fiscal.</p></div>
        </header>
        <div className="form-grid form-grid--two">
          <Field label="Email" name="email" type="email" error={error("email")} defaultValue={defaults.email} />
          <Field label="Teléfono" name="phone" type="tel" error={error("phone")} defaultValue={defaults.phone} />
          <Field label="WhatsApp" name="whatsapp" type="tel" error={error("whatsapp")} defaultValue={defaults.whatsapp} />
          <Field label="CUIT / identificación fiscal" name="taxId" error={error("taxId")} defaultValue={defaults.taxId} />
          <Field label="Sitio web" name="website" type="url" error={error("website")} defaultValue={defaults.website} />
          <Field label="Dirección" name="address" error={error("address")} defaultValue={defaults.address} />
        </div>
      </section>

      <section className="form-sheet" aria-labelledby="notes-heading">
        <header className="form-sheet__heading">
          <span>03</span>
          <div><h2 id="notes-heading">Notas del legajo</h2><p>Contexto breve para futuras conversaciones.</p></div>
        </header>
        <label className="field-stack">
          <span>Notas</span>
          <textarea name="notes" className="form-control form-textarea" defaultValue={defaults.notes ?? ""} aria-invalid={Boolean(error("notes"))} aria-describedby={error("notes") ? "notes-error" : undefined} />
          {error("notes") ? <small id="notes-error" className="field-error">{error("notes")}</small> : null}
        </label>
      </section>

      {state.status === "error" && state.message ? <p className="form-error" role="alert">{state.message}</p> : null}
      <footer className="client-form__actions">
        <button type="submit" className="primary-button" disabled={pending}>
          {pending ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}
          {pending ? "Guardando…" : "Guardar cliente"}
        </button>
      </footer>
    </form>
  );
}

function Field({ label, name, type = "text", required, error, defaultValue }: { label: string; name: string; type?: string; required?: boolean; error?: string; defaultValue?: string | null }) {
  const errorId = `${name}-error`;
  return (
    <label className="field-stack">
      <span>{label}{required ? " *" : ""}</span>
      <input className="form-control" name={name} type={type} required={required} defaultValue={defaultValue ?? ""} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} />
      {error ? <small id={errorId} className="field-error">{error}</small> : null}
    </label>
  );
}
