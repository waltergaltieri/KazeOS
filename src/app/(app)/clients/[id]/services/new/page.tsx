import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ServiceForm } from "@/components/services/service-form";
import { createServiceAction } from "@/lib/actions/services";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";
import { getClientById } from "@/lib/queries/clients";

export default async function NewServicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await getClientById(id);
  if (!client) notFound();

  const today = todayInBusinessZone(new Date());

  return (
    <main className="client-editor-page service-editor-page">
      <Link className="back-link" href={`/clients/${client.id}/services`}>
        <ArrowLeft size={16} aria-hidden="true" /> Volver a servicios
      </Link>
      <header className="page-heading">
        <p className="eyebrow">Nuevo acuerdo</p>
        <h1>Crear servicio</h1>
        <p>Definí el valor y la regla que proyectará sus próximos cargos.</p>
      </header>
      <ServiceForm
        action={createServiceAction}
        clientId={client.id}
        defaults={{
          automaticChargeGeneration: true,
          billingDay: Number(today.slice(-2)),
          billingFrequency: "monthly",
          billingType: "recurring",
          currency: "USD",
          startDate: today,
          status: "active",
        }}
      />
    </main>
  );
}
