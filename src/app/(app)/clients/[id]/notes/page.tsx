import { notFound } from "next/navigation";

import { ClientHeader } from "@/components/clients/client-header";
import { ClientTabs } from "@/components/clients/client-tabs";
import { NotesTimeline } from "@/components/clients/notes-timeline";
import { getClientNotes } from "@/lib/queries/client-notes";
import { getClientById } from "@/lib/queries/clients";

export default async function ClientNotesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [client, notes] = await Promise.all([getClientById(id), getClientNotes(id)]);
  if (!client) notFound();
  return <main className="client-detail-page notes-page"><ClientHeader client={client} /><ClientTabs clientId={client.id} active="notes" /><header className="service-page-heading"><div><p className="eyebrow">Memoria comercial</p><h2>Notas</h2><p>Contexto ordenado desde la conversación más reciente.</p></div></header><NotesTimeline clientId={client.id} notes={notes} /></main>;
}
