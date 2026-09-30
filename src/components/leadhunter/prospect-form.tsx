"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import type { LeadHunterActionState } from "@/lib/actions/leadhunter";

type ProspectFormAction = (
  state: LeadHunterActionState,
  formData: FormData,
) => Promise<LeadHunterActionState>;

const initialState: LeadHunterActionState = { status: "idle" };

export function ProspectForm({ campaignId, action }: { campaignId: string; action: ProspectFormAction }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialState);
  const error = (field: string) => state.fieldErrors?.[field]?.[0];

  useEffect(() => {
    if (state.status === "success" && state.leadId) {
      router.replace(`/leadhunter/leads/${state.leadId}`);
    }
  }, [router, state]);

  return (
    <form action={formAction} className="prospect-form" noValidate>
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="sourceType" value="manual" />
      <div className="form-grid form-grid--two">
        <label className="field-stack"><span>Negocio *</span><input className="form-control" name="name" required aria-invalid={Boolean(error("name"))} />{error("name") ? <small className="field-error">{error("name")}</small> : null}</label>
        <label className="field-stack"><span>País</span><select className="form-control" name="countryCode" defaultValue="AR"><option value="AR">Argentina</option><option value="US">Estados Unidos</option></select></label>
        <label className="field-stack"><span>Ciudad</span><input className="form-control" name="city" /></label>
        <label className="field-stack"><span>Sitio web</span><input className="form-control" name="website" type="url" placeholder="negocio.com" /></label>
      </div>
      <label className="field-stack"><span>Qué observaste</span><textarea className="form-control form-textarea" name="description" placeholder="Actividad, forma de vender o proceso que conviene investigar…" /></label>
      <div className="form-grid form-grid--two">
        <label className="field-stack"><span>Nombre del contacto</span><input className="form-control" name="firstName" /></label>
        <label className="field-stack"><span>Apellido</span><input className="form-control" name="lastName" /></label>
        <label className="field-stack"><span>Rol</span><input className="form-control" name="role" /></label>
        <label className="field-stack"><span>Correo</span><input className="form-control" name="email" type="email" /></label>
        <label className="field-stack"><span>Teléfono</span><input className="form-control" name="phone" type="tel" /></label>
        <label className="field-stack"><span>Fuente</span><input className="form-control" name="sourceUrl" type="url" /></label>
      </div>
      {state.status === "error" && state.message ? <p className="form-error" role="alert">{state.message}</p> : null}
      <button className="primary-button" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}{pending ? "Agregando…" : "Agregar prospecto"}</button>
    </form>
  );
}
