import { ArrowLeft, CalendarClock, Mail, Search } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ProspectForm } from "@/components/leadhunter/prospect-form";
import { RunStatus } from "@/components/leadhunter/run-status";
import { controlLeadHunterCampaignAction, createLeadHunterLeadAction } from "@/lib/actions/leadhunter";
import { getLeadHunterCampaignWorkspace } from "@/lib/queries/leadhunter";

const sourceLabel: Record<string, string> = { web_search: "Web", directories: "Directorios", csv: "CSV", manual: "Manual", instagram: "Instagram", linkedin: "LinkedIn" };
const evaluationLabel: Record<string, string> = { pending: "Pendiente", eligible: "Elegible", excluded: "Excluido", needs_review: "Revisar", no_email: "Sin correo" };

export default async function LeadHunterCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await getLeadHunterCampaignWorkspace(id);
  if (!workspace) { notFound(); return null; }
  const { campaign, strategy = null, prospects, runs = [] } = workspace;

  return (
    <main className="campaign-workspace">
      <Link className="back-link" href="/leadhunter"><ArrowLeft size={16} aria-hidden="true" /> Volver a campañas</Link>
      <header className="page-heading page-heading--actions">
        <div><p className="eyebrow">Campaña · versión {campaign.configVersion}</p><h1>{campaign.name}</h1><p>{campaign.objective}</p></div>
        <div className="campaign-control-actions"><span className={`leadhunter-status leadhunter-status--${campaign.status}`}>{campaign.status === "draft" ? "Borrador" : campaign.status === "active" ? "Activa" : campaign.status === "paused" ? "En pausa" : "Archivada"}</span>{campaign.status === "active" ? <><form action={controlLeadHunterCampaignAction}><input type="hidden" name="campaignId" value={campaign.id}/><button className="secondary-button" name="command" value="run_now">Buscar ahora</button></form><form action={controlLeadHunterCampaignAction}><input type="hidden" name="campaignId" value={campaign.id}/><button className="secondary-button" name="command" value="pause">Pausar</button></form></> : campaign.status !== "archived" ? <form action={controlLeadHunterCampaignAction}><input type="hidden" name="campaignId" value={campaign.id}/><button className="primary-button" name="command" value="activate">Activar agente</button></form> : null}</div>
      </header>

      <section className="campaign-brief" aria-label="Configuración de campaña">
        <div><Search size={17} aria-hidden="true" /><span>Fuentes</span><strong>{campaign.sources.map((source) => sourceLabel[source] ?? source).join(" y ")}</strong></div>
        <div><CalendarClock size={17} aria-hidden="true" /><span>Búsqueda</span><strong>{campaign.schedule.searchTime} · {campaign.dailyLeadLimit} por corrida</strong></div>
        <div><Mail size={17} aria-hidden="true" /><span>Envíos</span><strong>{campaign.schedule.sendStart}–{campaign.schedule.sendEnd} · {campaign.dailyEmailLimit}/día</strong></div>
      </section>

      {strategy ? <section className="leadhunter-panel campaign-strategy"><header><p className="eyebrow">Estrategia activa</p><h2>Qué hará el agente</h2></header><div className="strategy-grid"><div><strong>Dónde buscará</strong><p>{strategy.discovery.countries.join(", ")} · {strategy.discovery.sources.map((source) => sourceLabel[source] ?? source).join(", ")}</p></div><div><strong>Qué investigará</strong><ul>{strategy.research.questions.map((question) => <li key={question.key}>{question.prompt}</li>)}</ul></div><div><strong>Cómo calificará</strong><p>{strategy.qualification.gates.length} condiciones obligatorias · {strategy.qualification.rules.length} señales ponderadas</p></div><div><strong>Cómo escribirá</strong><p>{strategy.message.language} · {strategy.message.cta}</p><small>{strategy.message.signature}</small></div></div></section> : null}
      <RunStatus runs={runs} />

      <div className="campaign-workspace-grid">
        <section className="campaign-prospects" aria-labelledby="campaign-prospects-title">
          <header><div><p className="eyebrow">Selección</p><h2 id="campaign-prospects-title">Prospectos</h2></div><span>{prospects.length}</span></header>
          {prospects.length ? <div className="prospect-list">{prospects.map((prospect) => <article key={prospect.id}><div><Link href={`/leadhunter/leads/${prospect.id}`}>{prospect.name}</Link><span>{[prospect.city, prospect.countryCode].filter(Boolean).join(" · ")}</span></div><span className={`prospect-evaluation prospect-evaluation--${prospect.evaluation}`}>{evaluationLabel[prospect.evaluation]}</span><div className="prospect-channel">{prospect.email ?? prospect.website ?? "Sin canal digital confirmado"}</div></article>)}</div> : <div className="campaign-inline-empty"><p>Todavía no hay prospectos. Podés cargar uno ahora; la búsqueda automática llegará en la siguiente entrega.</p></div>}
        </section>

        <aside className="campaign-add-prospect" aria-labelledby="add-prospect-title">
          <header><p className="eyebrow">Carga manual</p><h2 id="add-prospect-title">Agregar prospecto</h2><p>No hace falta inventar un correo ni un sitio.</p></header>
          <ProspectForm campaignId={campaign.id} action={createLeadHunterLeadAction} />
        </aside>
      </div>
    </main>
  );
}
