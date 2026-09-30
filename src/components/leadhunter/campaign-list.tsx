import {
  ArrowRight,
  CirclePause,
  FilePenLine,
  MailCheck,
  Play,
  Radar,
} from "lucide-react";
import Link from "next/link";

import type { LeadHunterCampaignListItem } from "@/lib/queries/leadhunter";

const statusLabel = {
  draft: "Borrador",
  active: "Activa",
  paused: "En pausa",
  archived: "Archivada",
} as const;

const serviceLabel: Record<string, string> = {
  custom_management: "Gestión a medida",
  web: "Sitios web",
  ecommerce: "Ecommerce",
  ai_bots: "Bots con IA",
  automation: "Automatizaciones",
};

const sourceLabel: Record<string, string> = {
  web_search: "Web",
  directories: "Directorios",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  csv: "CSV",
  manual: "Manual",
};

function StatusIcon({ status }: { status: LeadHunterCampaignListItem["status"] }) {
  if (status === "active") return <Play size={14} aria-hidden="true" />;
  if (status === "paused") return <CirclePause size={14} aria-hidden="true" />;
  if (status === "draft") return <FilePenLine size={14} aria-hidden="true" />;
  return <MailCheck size={14} aria-hidden="true" />;
}

export function CampaignList({ campaigns }: { campaigns: LeadHunterCampaignListItem[] }) {
  return (
    <section className="leadhunter-campaigns" aria-label="Campañas de LeadHunter">
      {campaigns.map((campaign) => (
        <article className="leadhunter-campaign" key={campaign.id}>
          <header className="leadhunter-campaign__heading">
            <div>
              <div className="leadhunter-campaign__status-row">
                <span className={`leadhunter-status leadhunter-status--${campaign.status}`}>
                  <StatusIcon status={campaign.status} /> {statusLabel[campaign.status]}
                </span>
                <span>{serviceLabel[campaign.serviceFocus] ?? campaign.serviceFocus}</span>
                <span>{campaign.countries.join(" · ")}</span>
              </div>
              <h2>{campaign.name}</h2>
              <p>{campaign.objective}</p>
            </div>
            <Link href={`/leadhunter/campaigns/${campaign.id}`} aria-label={`Abrir campaña ${campaign.name}`}>
              Abrir <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </header>

          <ol className="campaign-route" aria-label="Recorrido de la campaña">
            <li className="is-complete"><span>1</span><div><strong>Buscar</strong><small>{campaign.leadCount} prospectos</small></div></li>
            <li className={campaign.leadCount > 0 ? "is-complete" : undefined}><span>2</span><div><strong>Investigar</strong><small>{campaign.readyCount} preparados</small></div></li>
            <li className={campaign.readyCount > 0 ? "is-current" : undefined}><span>3</span><div><strong>Preparar</strong><small>{campaign.dailyEmailLimit}/día</small></div></li>
            <li className={campaign.contactingCount > 0 ? "is-current" : undefined}><span>4</span><div><strong>Contactar</strong><small>{campaign.repliedCount} respuestas</small></div></li>
          </ol>

          <footer className="leadhunter-campaign__footer">
            <span><Radar size={14} aria-hidden="true" /> {campaign.sources.map((source) => sourceLabel[source] ?? source).join(", ")}</span>
            <span>{campaign.automationMode === "automatic" ? "Envío automático" : "Sólo borradores"}</span>
            <span>Hasta {campaign.dailyLeadLimit} candidatos por corrida</span>
          </footer>
        </article>
      ))}
    </section>
  );
}
