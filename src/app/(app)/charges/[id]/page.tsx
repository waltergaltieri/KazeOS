import { notFound } from "next/navigation";
import { PaymentHistory } from "@/components/payments/payment-history";
import { ChargeStatusBadge } from "@/components/charges/charge-status-badge";
import { formatMoney } from "@/lib/domain/money";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";
import { getChargeById } from "@/lib/queries/charges";
export default async function ChargeDetailPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; const item = await getChargeById(id, todayInBusinessZone(new Date())); if (!item) notFound(); return <main className="charge-detail-page"><header className="page-heading"><p className="eyebrow">Cuenta de {item.clientName}</p><h1>{item.description}</h1><p>{item.serviceName ?? "Cobro manual"}</p></header><section className="charge-detail-summary"><div><span>Importe</span><strong>{formatMoney(item.amountMinor, item.currency)}</strong></div><div><span>Cobrado</span><strong>{formatMoney(item.amountPaidMinor, item.currency)}</strong></div><div><span>Estado</span><ChargeStatusBadge status={item.status} /></div></section><section className="payment-history-sheet"><header><p className="eyebrow">Riel cronológico</p><h2>Historial de pagos</h2></header><PaymentHistory payments={item.payments} /></section></main>; }
