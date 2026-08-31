"use client";

import { Building2, LoaderCircle, Save } from "lucide-react";
import { useActionState } from "react";

import { updateBusinessSettingsAction, type SettingsActionState } from "@/lib/actions/settings";
import type { UserSettings } from "@/lib/queries/settings";
import { SettingsFeedback } from "./profile-form";

const initial: SettingsActionState = { status: "idle" };

export function BusinessForm({ settings }: { settings: UserSettings["business"] }) {
  const [state, action, pending] = useActionState(updateBusinessSettingsAction, initial);
  const error = (field: string) => state.fieldErrors?.[field]?.[0];
  return <form action={action} className="settings-sheet" aria-labelledby="business-settings-title">
    <header><span aria-hidden="true"><Building2 size={18} /></span><div><p className="eyebrow">Operación</p><h2 id="business-settings-title">Negocio y región</h2><p>Preferencias de presentación para fechas e importes.</p></div></header>
    <div className="form-grid form-grid--two">
      <div className="field-stack"><label htmlFor="business-name">Nombre del negocio</label><input id="business-name" className="form-control" name="businessName" defaultValue={settings.businessName ?? ""} maxLength={200} /></div>
      <div className="field-stack"><label htmlFor="primary-currency">Moneda principal</label><select id="primary-currency" className="form-control" name="primaryCurrency" defaultValue={settings.primaryCurrency} aria-describedby="primary-currency-note"><option value="USD">USD</option><option value="ARS">ARS</option></select>{error("primaryCurrency") ? <small className="field-error">{error("primaryCurrency")}</small> : null}<small id="primary-currency-note" className="field-note">Define la presentación inicial; no convierte ni mezcla los totales de USD y ARS.</small></div>
      <div className="field-stack"><label htmlFor="business-timezone">Zona horaria</label><select id="business-timezone" className="form-control" name="timezone" defaultValue={settings.timezone}><option value="America/Argentina/Buenos_Aires">Buenos Aires (UTC−3)</option></select>{error("timezone") ? <small className="field-error">{error("timezone")}</small> : null}</div>
      <div className="field-stack"><label htmlFor="business-locale">Idioma y región</label><select id="business-locale" className="form-control" name="locale" defaultValue={settings.locale}><option value="es-AR">Español (Argentina)</option></select>{error("locale") ? <small className="field-error">{error("locale")}</small> : null}</div>
      <div className="field-stack settings-business-info"><label htmlFor="business-info">Información del negocio</label><textarea id="business-info" className="form-control form-textarea" name="businessInfo" defaultValue={settings.businessInfo ?? ""} maxLength={2000} /></div>
    </div>
    <SettingsFeedback state={state} />
    <footer><button className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Guardar preferencias</button></footer>
  </form>;
}
