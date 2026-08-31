import { BusinessForm } from "@/components/settings/business-form";
import { ProfileForm } from "@/components/settings/profile-form";
import { getSettings } from "@/lib/queries/settings";

export default async function SettingsPage() {
  const current = await getSettings();
  return <main className="settings-page"><header className="page-heading"><div><p className="eyebrow">Preferencias</p><h1>Configuración</h1><p>Ajustá tu identidad y la presentación del negocio.</p></div></header><div className="settings-grid"><ProfileForm profile={current.profile} /><BusinessForm settings={current.business} /></div></main>;
}
