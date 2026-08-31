import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientForm } from "@/components/clients/client-form";
import { updateClientAction } from "@/lib/actions/clients";
import { getClientById } from "@/lib/queries/clients";

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = await getClientById(id);
  if (!client) notFound();

  return (
    <main className="client-editor-page">
      <Link className="back-link" href={`/clients/${client.id}`}><ArrowLeft size={16} aria-hidden="true" /> Volver al legajo</Link>
      <header className="page-heading"><p className="eyebrow">Edición de legajo</p><h1>Editar cliente</h1><p>Actualizá la ficha sin perder su historia.</p></header>
      <ClientForm action={updateClientAction} defaults={client} />
    </main>
  );
}
