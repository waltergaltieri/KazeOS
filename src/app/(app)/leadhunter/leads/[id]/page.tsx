import { ArrowLeft, ExternalLink, Mail, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getLeadHunterLeadById } from "@/lib/queries/leadhunter";
import { ResearchDossier } from "@/components/leadhunter/research-dossier";
import { QualificationPanel } from "@/components/leadhunter/qualification-panel";
import { MessageReview } from "@/components/leadhunter/message-review";

export default async function LeadHunterLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getLeadHunterLeadById(id);
  if (!result) { notFound(); return null; }
  const { lead, contacts, evidence, campaigns, audits = [], messages = [], outbox = [] } = result;
  const hypotheses = evidence.filter((item) => item.kind === "hypothesis");

  return (
    <main className="lead-profile-page">
      <Link className="back-link" href="/leadhunter"><ArrowLeft size={16} aria-hidden="true" /> Volver a LeadHunter</Link>
      <header className="page-heading"><p className="eyebrow">Prospecto</p><h1>{lead.name}</h1><p>{lead.description ?? "Negocio pendiente de investigación."}</p></header>
      <section className="lead-identity-strip">
        <span><MapPin size={15} aria-hidden="true" /> {[lead.city, lead.countryCode].filter(Boolean).join(", ") || "Ubicación desconocida"}</span>
        {lead.website ? <a href={lead.website} target="_blank" rel="noreferrer">Sitio web <ExternalLink size={14} aria-hidden="true" /></a> : <span>Sitio no informado</span>}
        <span>{lead.linkedClientId ? "Vinculado a cliente" : "Aún no es cliente"}</span>
      </section>
      <div className="lead-profile-grid">
        <ResearchDossier evidence={evidence} />
        <QualificationPanel campaigns={campaigns} audits={audits} />
        <MessageReview messages={messages} outbox={outbox} />
        <section className="lead-evidence-sheet lead-evidence-sheet--hypothesis"><header><p className="eyebrow">Diagnóstico</p><h2>Hipótesis para conversar</h2></header>{hypotheses.length ? <ul>{hypotheses.map((item) => <li key={item.id}><strong>{item.value}</strong><span>No está confirmado por el prospecto</span></li>)}</ul> : <p>Todavía no hay hipótesis. La investigación debe aportar primero señales verificables.</p>}</section>
        <section className="lead-contact-sheet"><header><p className="eyebrow">Personas</p><h2>Contactos</h2></header>{contacts.length ? <ul>{contacts.map((contact) => <li key={contact.id}><strong>{[contact.firstName, contact.lastName].filter(Boolean).join(" ") || contact.role || "Contacto"}</strong>{contact.role ? <span>{contact.role}</span> : null}{contact.email ? <a href={`mailto:${contact.email}`}><Mail size={14} aria-hidden="true" /> {contact.email}</a> : null}{contact.phone ? <span><Phone size={14} aria-hidden="true" /> {contact.phone}</span> : null}</li>)}</ul> : <p>No se encontró una persona de contacto.</p>}</section>
        <section className="lead-contact-sheet"><header><p className="eyebrow">Participación</p><h2>Campañas</h2></header><ul>{campaigns.map((campaign) => <li key={campaign.campaignId}><Link href={`/leadhunter/campaigns/${campaign.campaignId}`}><strong>{campaign.campaignName}</strong></Link><span>{campaign.evaluation} · {campaign.status}</span></li>)}</ul></section>
      </div>
    </main>
  );
}
