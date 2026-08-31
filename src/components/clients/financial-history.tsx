import { ArrowDownLeft, ArrowUpRight, ReceiptText } from "lucide-react";
import Link from "next/link";

import { formatAggregateMoney } from "@/lib/domain/money";
import type { ClientFinancialHistoryResult } from "@/lib/queries/client-financial-history";

const statusLabel = {
  pending: "Pendiente", due_today: "Vence hoy", overdue: "Vencido",
  partial: "Parcial", paid: "Pagado", cancelled: "Cancelado",
};

export function FinancialHistory({ clientId, result }: { clientId: string; result: ClientFinancialHistoryResult }) {
  return <section id="financial-history" className="financial-history-sheet" aria-labelledby="financial-history-title">
    <header><div><p className="eyebrow">Movimientos reales</p><h2 id="financial-history-title">Historial financiero</h2></div><span>{result.items.length} movimientos visibles</span></header>
    {result.items.length ? <ol className="financial-history-rail">
      {result.items.map((item) => <li key={`${item.kind}-${item.id}`}>
        <span className={`financial-history-mark financial-history-mark--${item.kind}`} aria-hidden="true">{item.kind === "payment" ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}</span>
        <div><strong>{item.label}</strong><time dateTime={item.date}>{item.date.split("-").reverse().join("/")}</time>{item.status ? <span className={`charge-status charge-status--${item.status}`}>{statusLabel[item.status]}</span> : <span className="movement-kind">Pago registrado</span>}</div>
        <div><strong>{formatAggregateMoney(item.amountMinor, item.currency)}</strong>{item.chargeId ? <Link className="quiet-button" href={`/charges/${item.chargeId}`} aria-label={`Ver cobro de ${item.label}`}>Ver cobro</Link> : <span>Sin imputar</span>}</div>
      </li>)}
    </ol> : <div className="financial-history-empty"><ReceiptText size={22} aria-hidden="true" /><div><strong>Todavía no hay movimientos financieros.</strong><p>Los cobros y pagos reales del cliente aparecerán acá.</p></div><Link className="secondary-button" href={`/charges/new?clientId=${clientId}`}>Crear primer cobro</Link></div>}
    {result.hasMore ? <footer><Link className="secondary-button" href={`/clients/${clientId}?historyLimit=${result.limit + 20}#financial-history`}>Mostrar más movimientos</Link></footer> : null}
  </section>;
}
