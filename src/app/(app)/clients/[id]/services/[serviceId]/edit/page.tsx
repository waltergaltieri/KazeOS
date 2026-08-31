import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ServiceForm } from "@/components/services/service-form";
import { updateServiceAction } from "@/lib/actions/services";
import { getClientById } from "@/lib/queries/clients";
import { getServiceById } from "@/lib/queries/services";

export default async function EditServicePage({
  params,
}: {
  params: Promise<{ id: string; serviceId: string }>;
}) {
  const { id, serviceId } = await params;
  const [client, service] = await Promise.all([
    getClientById(id),
    getServiceById(id, serviceId),
  ]);

  if (!client || !service) notFound();

  return (
    <main className="client-editor-page service-editor-page">
      <Link className="back-link" href={`/clients/${client.id}/services`}>
        <ArrowLeft size={16} aria-hidden="true" /> Volver a servicios
      </Link>
      <header className="page-heading">
        <p className="eyebrow">Acuerdo vigente</p>
        <h1>Editar servicio</h1>
        <p>Los cargos cobrados y el historial anterior permanecen protegidos.</p>
      </header>
      <ServiceForm
        action={updateServiceAction}
        clientId={client.id}
        currencyLocked={service.hasCharges}
        defaults={service}
      />
    </main>
  );
}
