import { CircleDollarSign } from "lucide-react";
import { formatMoney } from "@/lib/domain/money";
const methods: Record<string, string> = { bank_transfer: "Transferencia", cash: "Efectivo", mercadopago: "Mercado Pago", paypal: "PayPal", payoneer: "Payoneer", stripe: "Stripe", crypto: "Cripto", other: "Otro" };
type Payment = { id: string; amountMinor: number; currency: "USD" | "ARS"; paymentDate: string; paymentMethod: string; reference: string | null; notes: string | null; createdAt: Date };
export function PaymentHistory({ payments }: { payments: Payment[] }) {
  if (!payments.length) return <div className="payment-empty"><p>Sin movimientos registrados.</p><span>El primer pago aparecerá acá.</span></div>;
  return <ol className="payment-rail" aria-label="Historial cronológico de pagos">{payments.map((payment) => <li key={payment.id}>
    <span className="payment-rail__mark" aria-hidden="true"><CircleDollarSign size={16} /></span>
    <div><strong>{formatMoney(payment.amountMinor, payment.currency)}</strong><span>{methods[payment.paymentMethod] ?? payment.paymentMethod}</span>{payment.reference ? <small>{payment.reference}</small> : null}{payment.notes ? <p>{payment.notes}</p> : null}</div>
    <time dateTime={payment.paymentDate}>{new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${payment.paymentDate}T00:00:00Z`))}</time>
  </li>)}</ol>;
}
