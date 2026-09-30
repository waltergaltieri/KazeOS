import { ArrowLeft, ArrowRight, Building2, Globe2 } from "lucide-react";
import Link from "next/link";

import { getLeadHunterLeads } from "@/lib/queries/leadhunter";

const statusLabel: Record<string, string> = {
  new: "Nuevo",
  researching: "Investigando",
  qualified: "Calificado",
  excluded: "Excluido",
  converted: "Cliente",
  archived: "Archivado",
};

export default async function LeadHunterLeadsPage() {
  const prospects = await getLeadHunterLeads();

  return (
    <main className="leadhunter-leads-page">
      <Link className="back-link" href="/leadhunter"><ArrowLeft size={16} aria-hidden="true" /> Volver a campañas</Link>
      <header className="page-heading"><p className="eyebrow">Base de oportunidades</p><h1>Prospectos</h1><p>Negocios encontrados o cargados, aunque participen en más de una campaña.</p></header>
      {prospects.length ? (
        <section className="leadhunter-lead-directory" aria-label="Listado de prospectos">
          {prospects.map((prospect) => (
            <article key={prospect.id}>
              <span className="lead-directory-mark"><Building2 size={18} aria-hidden="true" /></span>
              <div>
                <Link href={`/leadhunter/leads/${prospect.id}`}>{prospect.name}</Link>
                <span>{[prospect.city, prospect.countryCode].filter(Boolean).join(" · ") || "Ubicación desconocida"}</span>
              </div>
              <span className={`leadhunter-status leadhunter-status--${prospect.status === "qualified" || prospect.status === "converted" ? "active" : prospect.status === "excluded" ? "paused" : "draft"}`}>{statusLabel[prospect.status] ?? prospect.status}</span>
              <span className="lead-directory-website"><Globe2 size={14} aria-hidden="true" /> {prospect.website ? new URL(prospect.website).hostname : "Sin sitio informado"}</span>
              <Link className="lead-directory-open" href={`/leadhunter/leads/${prospect.id}`} aria-label={`Abrir prospecto ${prospect.name}`}><ArrowRight size={17} aria-hidden="true" /></Link>
            </article>
          ))}
        </section>
      ) : (
        <section className="campaign-inline-empty"><p>Todavía no hay prospectos. Agregalos desde una campaña para conservar su origen.</p></section>
      )}
    </main>
  );
}
