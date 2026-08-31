import { Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChargeCancelControl } from "@/components/charges/charge-cancel-control";
import { PaymentHistory } from "@/components/payments/payment-history";
import { ChargeStatusBadge } from "@/components/charges/charge-status-badge";
import { formatMoney } from "@/lib/domain/money";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";
import { getChargeById } from "@/lib/queries/charges";
export default async function ChargeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const today = todayInBusinessZone(new Date());
  const item = await getChargeById(id, today);
  if (!item) notFound();
  const editable = !item.generatedAutomatically && item.persistedStatus === "pending" && item.amountPaidMinor === 0;

  return <main className="charge-detail-page"><header className="page-heading page-heading--actions"><div><p className="eyebrow">Cuenta de {item.clientName}</p><h1>{item.description}</h1><p>{item.serviceName ?? "Cobro manual"}</p></div>{editable ? <div className="charge-detail-actions"><Link className="secondary-button" href={`/charges/${item.id}/edit`}><Pencil size={16} /> Editar cobro</Link><ChargeCancelControl chargeId={item.id} /></div> : null}</header><section className="charge-detail-summary"><div><span>Importe</span><strong>{formatMoney(item.amountMinor, item.currency)}</strong></div><div><span>Cobrado</span><strong>{formatMoney(item.amountPaidMinor, item.currency)}</strong></div><div><span>Estado</span><ChargeStatusBadge status={item.status} /></div></section><section className="payment-history-sheet"><header><p className="eyebrow">Riel cronológico</p><h2>Historial de pagos</h2></header><PaymentHistory payments={item.payments} charge={item} today={today} /></section></main>;
}
