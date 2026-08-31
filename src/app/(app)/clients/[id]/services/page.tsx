import { Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ClientHeader } from "@/components/clients/client-header";
import { ClientTabs } from "@/components/clients/client-tabs";
import { ServiceList } from "@/components/services/service-list";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";
import { getClientById } from "@/lib/queries/clients";
import { getServices } from "@/lib/queries/services";

export default async function ClientServicesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [client, clientServices] = await Promise.all([
    getClientById(id),
    getServices(id, todayInBusinessZone(new Date())),
  ]);

  if (!client) notFound();

  return (
    <main className="client-detail-page services-page">
      <ClientHeader client={client} />
      <ClientTabs clientId={client.id} active="services" />
      <header className="service-page-heading">
        <div>
          <p className="eyebrow">Acuerdos comerciales</p>
          <h2>Servicios</h2>
          <p>Revisá la cadencia, el próximo vencimiento y la generación automática.</p>
        </div>
        {clientServices.length > 0 ? (
          <Link className="primary-button" href={`/clients/${client.id}/services/new`}>
            <Plus size={17} aria-hidden="true" /> Nuevo servicio
          </Link>
        ) : null}
      </header>
      <ServiceList clientId={client.id} services={clientServices} />
    </main>
  );
}
