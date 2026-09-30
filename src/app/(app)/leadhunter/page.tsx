import { Plus, Radar, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { CampaignList } from "@/components/leadhunter/campaign-list";
import { getLeadHunterCampaigns } from "@/lib/queries/leadhunter";

export default async function LeadHunterPage() {
  const campaigns = await getLeadHunterCampaigns();
  const active = campaigns.filter((campaign) => campaign.status === "active").length;
  const replies = campaigns.reduce((total, campaign) => total + campaign.repliedCount, 0);

  return (
    <main className="leadhunter-page">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="eyebrow">Prospección comercial</p>
          <h1>LeadHunter</h1>
          <p>Buscá negocios, reuní evidencia y prepará cada conversación desde una campaña.</p>
        </div>
        <div className="leadhunter-heading-actions">
          <Link className="secondary-button" href="/leadhunter/leads">Ver prospectos</Link>
          <Link className="primary-button" href="/leadhunter/campaigns/new">
            <Plus size={17} aria-hidden="true" /> Nueva campaña
          </Link>
        </div>
      </header>

      {campaigns.length ? (
        <>
          <section className="leadhunter-command-strip" aria-label="Estado de LeadHunter">
            <div><span>Campañas activas</span><strong>{active}</strong></div>
            <div><span>Respuestas registradas</span><strong>{replies}</strong></div>
            <div className="leadhunter-command-strip__guard">
              <ShieldCheck size={18} aria-hidden="true" />
              <span>Los borradores no envían correos hasta conectar una cuenta y activar el modo automático.</span>
            </div>
          </section>
          <CampaignList campaigns={campaigns} />
        </>
      ) : (
        <section className="leadhunter-empty" aria-labelledby="leadhunter-empty-title">
          <span><Radar size={28} aria-hidden="true" /></span>
          <div>
            <p className="eyebrow">Punto de partida</p>
            <h2 id="leadhunter-empty-title">Creá tu primera búsqueda</h2>
            <p>Definí qué empresas querés encontrar, qué señales observar y cómo sería la secuencia. Todavía no se enviará ningún correo.</p>
          </div>
          <Link className="primary-button" href="/leadhunter/campaigns/new">Crear campaña</Link>
        </section>
      )}
    </main>
  );
}
