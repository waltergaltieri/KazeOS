"use client";

import { LoaderCircle, Save, UserRound } from "lucide-react";
import { useActionState } from "react";

import { updateProfileSettingsAction, type SettingsActionState } from "@/lib/actions/settings";

const initial: SettingsActionState = { status: "idle" };

export function ProfileForm({ profile }: { profile: { fullName: string; email: string } }) {
  const [state, action, pending] = useActionState(updateProfileSettingsAction, initial);
  const fullNameError = state.fieldErrors?.fullName?.[0];
  return <form action={action} className="settings-sheet" aria-labelledby="profile-settings-title">
    <header><span aria-hidden="true"><UserRound size={18} /></span><div><p className="eyebrow">Identidad</p><h2 id="profile-settings-title">Perfil</h2><p>Cómo aparece tu cuenta dentro de KazeOS.</p></div></header>
    <div className="form-grid form-grid--two"><div className="field-stack"><label htmlFor="profile-full-name">Nombre visible</label><input id="profile-full-name" className="form-control" name="fullName" defaultValue={profile.fullName} required maxLength={160} aria-invalid={Boolean(fullNameError)} aria-describedby={fullNameError ? "profile-full-name-error" : undefined} />{fullNameError ? <small id="profile-full-name-error" className="field-error">{fullNameError}</small> : null}</div><div className="field-stack"><label htmlFor="profile-email">Email de acceso</label><input id="profile-email" className="form-control" type="email" value={profile.email} disabled /><small className="field-note">Proviene de tu cuenta autenticada y es la fuente autoritativa.</small></div></div>
    <SettingsFeedback state={state} />
    <footer><button className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Guardar perfil</button></footer>
  </form>;
}

export function SettingsFeedback({ state }: { state: SettingsActionState }) {
  if (state.status === "idle" || !state.message) return null;
  return <p className={state.status === "error" ? "form-error" : "form-success"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>;
}
