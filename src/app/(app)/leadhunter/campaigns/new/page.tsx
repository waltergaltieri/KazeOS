import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { CampaignForm } from "@/components/leadhunter/campaign-form";
import { createLeadHunterCampaignAction } from "@/lib/actions/leadhunter";

export default function NewLeadHunterCampaignPage() {
  return (
    <main className="leadhunter-editor-page">
      <Link className="back-link" href="/leadhunter"><ArrowLeft size={16} aria-hidden="true" /> Volver a LeadHunter</Link>
      <header className="page-heading"><p className="eyebrow">Nueva búsqueda</p><h1>Configurar campaña</h1><p>Prepará el objetivo, las señales y el ritmo de contacto. La campaña comienza como borrador.</p></header>
      <CampaignForm action={createLeadHunterCampaignAction} />
    </main>
  );
}
