import { AtSign, CalendarDays, Globe2, MapPin, Phone, ReceiptText } from "lucide-react";
import { notFound } from "next/navigation";

import { ClientHeader } from "@/components/clients/client-header";
import { ClientTabs } from "@/components/clients/client-tabs";
import { formatAggregateMoney } from "@/lib/domain/money";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";
import { getClientById, getClientSummary, type AggregateCurrencyPair } from "@/lib/queries/clients";

function MoneyPair({ value }: { value: AggregateCurrencyPair }) {
  return <span className="currency-stack"><span>{formatAggregateMoney(value.USD, "USD")}</span><span>{formatAggregateMoney(value.ARS, "ARS")}</span></span>;
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asOf = todayInBusinessZone(new Date());
  const [client, summary] = await Promise.all([getClientById(id), getClientSummary(id, asOf)]);
  if (!client || !summary) notFound();

  return (
    <main className="client-detail-page">
      <ClientHeader client={client} />
      <ClientTabs clientId={client.id} />

      <section className="summary-grid" aria-label="Resumen del cliente">
        <article><p>Saldo pendiente</p><MoneyPair value={summary.outstanding} /><small>Cargos no cancelados</small></article>
        <article><p>Cobrado histórico</p><MoneyPair value={summary.collected} /><small>Pagos registrados</small></article>
        <article><p>MRR</p><MoneyPair value={summary.mrr} /><small>Servicios recurrentes activos</small></article>
        <article><p>Próximo vencimiento</p><strong>{summary.nextDueDate ? summary.nextDueDate.split("-").reverse().join("/") : "Sin vencimientos"}</strong><small>{summary.activeServices} servicios activos · {summary.pendingTasks} tareas</small></article>
      </section>

      <div className="dossier-grid">
        <section className="dossier-sheet" aria-labelledby="contact-title">
          <header><p className="eyebrow">Ficha principal</p><h2 id="contact-title">Contacto</h2></header>
          <dl className="contact-ledger">
            <ContactRow icon={AtSign} label="Email" value={client.email} href={client.email ? `mailto:${client.email}` : undefined} />
            <ContactRow icon={Phone} label="Teléfono" value={client.phone} href={client.phone ? `tel:${client.phone}` : undefined} />
            <ContactRow icon={Phone} label="WhatsApp" value={client.whatsapp} href={client.whatsapp ? `https://wa.me/${client.whatsapp.replace(/\D/g, "")}` : undefined} />
            <ContactRow icon={Globe2} label="Sitio web" value={client.website} href={client.website ?? undefined} />
            <ContactRow icon={ReceiptText} label="Identificación fiscal" value={client.taxId} />
            <ContactRow icon={MapPin} label="Dirección" value={client.address} />
          </dl>
        </section>

        <aside className="chronology-sheet" aria-labelledby="chronology-title">
          <header><p className="eyebrow">Riel cronológico</p><h2 id="chronology-title">Historia del legajo</h2></header>
          <div className="chronology-item"><span aria-hidden="true"><CalendarDays size={16} /></span><div><strong>Cliente incorporado</strong><time dateTime={client.joinedAt}>{new Intl.DateTimeFormat("es-AR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${client.joinedAt}T00:00:00Z`))}</time></div></div>
          <div className="chronology-item"><span aria-hidden="true"><ReceiptText size={16} /></span><div><strong>Actividad vinculada</strong><span>{summary.activeServices} servicios activos · {summary.pendingTasks} tareas pendientes · {summary.notes} notas</span></div></div>
        </aside>
      </div>

      {client.notes ? <section className="dossier-note"><p className="eyebrow">Nota del legajo</p><p>{client.notes}</p></section> : null}
    </main>
  );
}

function ContactRow({ icon: Icon, label, value, href }: { icon: typeof AtSign; label: string; value: string | null; href?: string }) {
  return <div><dt><Icon size={16} aria-hidden="true" />{label}</dt><dd>{value ? (href ? <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>{value}</a> : value) : <span>Sin registrar</span>}</dd></div>;
}
