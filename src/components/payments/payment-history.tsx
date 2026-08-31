"use client";

import { CircleDollarSign } from "lucide-react";
import { useState } from "react";
import { formatMoney } from "@/lib/domain/money";
import { PaymentDialog, type PaymentDialogCharge } from "./payment-dialog";
const methods: Record<string, string> = { bank_transfer: "Transferencia", cash: "Efectivo", mercadopago: "Mercado Pago", paypal: "PayPal", payoneer: "Payoneer", stripe: "Stripe", crypto: "Cripto", other: "Otro" };
type Payment = { id: string; amountMinor: number; currency: "USD" | "ARS"; paymentDate: string; paymentMethod: string; reference: string | null; notes: string | null; createdAt: Date };
export function PaymentHistory({ payments, charge, today }: { payments: Payment[]; charge?: PaymentDialogCharge; today?: string }) {
  const [editing, setEditing] = useState<Payment | null>(null);
  if (!payments.length) return <div className="payment-empty"><p>Sin movimientos registrados.</p><span>El primer pago aparecerá acá.</span></div>;
  return <><ol className="payment-rail" aria-label="Historial cronológico de pagos">{payments.map((payment) => <li key={payment.id}>
    <span className="payment-rail__mark" aria-hidden="true"><CircleDollarSign size={16} /></span>
    <div><strong>{formatMoney(payment.amountMinor, payment.currency)}</strong><span>{methods[payment.paymentMethod] ?? payment.paymentMethod}</span>{payment.reference ? <small>{payment.reference}</small> : null}{payment.notes ? <p>{payment.notes}</p> : null}</div>
    <div className="payment-rail__actions"><time dateTime={payment.paymentDate}>{new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${payment.paymentDate}T00:00:00Z`))}</time>{charge && today ? <button type="button" className="quiet-button" aria-label={`Corregir pago de ${formatMoney(payment.amountMinor, payment.currency)}`} onClick={() => setEditing(payment)}>Corregir</button> : null}</div>
  </li>)}</ol>{editing && charge && today ? <PaymentDialog charge={charge} payment={editing} today={today} open onClose={() => setEditing(null)} /> : null}</>;
}
