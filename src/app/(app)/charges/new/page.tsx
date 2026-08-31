import { notFound } from "next/navigation";
import { ChargeForm } from "@/components/charges/charge-form";
import { createChargeAction } from "@/lib/actions/charges";
import { getClients } from "@/lib/queries/clients";
import { getPrimaryCurrency } from "@/lib/queries/settings";
export default async function NewChargePage({ searchParams }: { searchParams: Promise<{ clientId?: string }> }) { const { clientId } = await searchParams; const [clients, primaryCurrency] = await Promise.all([getClients({ filter: "active" }), getPrimaryCurrency()]); if (clientId && !clients.some((client) => client.id === clientId)) notFound(); const options = clients.map((client) => ({ id: client.id, displayName: [client.firstName, client.lastName].filter(Boolean).join(" ") + (client.company ? ` · ${client.company}` : "") })); return <main className="charge-editor-page"><header className="page-heading"><p className="eyebrow">Nuevo asiento</p><h1>Crear cobro manual</h1><p>Una obligación concreta, sin generación automática.</p></header><ChargeForm action={createChargeAction} clients={options} selectedClientId={clientId} defaultCurrency={primaryCurrency} /></main>; }
