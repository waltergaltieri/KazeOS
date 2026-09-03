import { BusinessForm } from "@/components/settings/business-form";
import { ExpenseCategoryManager } from "@/components/settings/expense-category-manager";
import { ProfileForm } from "@/components/settings/profile-form";
import { getExpenseCategories } from "@/lib/queries/expense-categories";
import { getSettings } from "@/lib/queries/settings";

export default async function SettingsPage() {
  const [current, categories] = await Promise.all([
    getSettings(),
    getExpenseCategories({ includeInactive: true }),
  ]);

  return <main className="settings-page"><header className="page-heading"><div><p className="eyebrow">Preferencias</p><h1>Configuración</h1><p>Ajustá tu identidad y la presentación del negocio.</p></div></header><div className="settings-grid"><ProfileForm profile={current.profile} /><BusinessForm settings={current.business} /><ExpenseCategoryManager categories={categories} /></div></main>;
}
