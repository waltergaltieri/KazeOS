import { Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChargeTable } from "@/components/charges/charge-table";
import { ClientHeader } from "@/components/clients/client-header";
import { ClientTabs } from "@/components/clients/client-tabs";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";
import { getClientById } from "@/lib/queries/clients";
import { getCharges } from "@/lib/queries/charges";
export default async function ClientChargesPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; const today = todayInBusinessZone(new Date()); const [client, items] = await Promise.all([getClientById(id), getCharges({ clientId: id }, today)]); if (!client) notFound(); return <main className="client-detail-page charges-page"><ClientHeader client={client} /><ClientTabs clientId={client.id} active="charges" /><header className="service-page-heading"><div><p className="eyebrow">Cuenta corriente</p><h2>Cobros</h2><p>Obligaciones y movimientos del legajo.</p></div><Link className="primary-button" href={`/charges/new?clientId=${client.id}`}><Plus size={17} /> Nuevo cobro</Link></header><ChargeTable charges={items} today={today} createHref={`/charges/new?clientId=${client.id}`} /></main>; }
