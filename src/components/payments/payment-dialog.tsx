"use client";
import { LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef } from "react";
import { createPaymentAction, type PaymentActionState } from "@/lib/actions/payments";
import { formatMoney } from "@/lib/domain/money";
import { LedgerSelect } from "@/components/ui/ledger-select";
const initial: PaymentActionState = { status: "idle" };
function amountValue(minor: number) { return `${Math.floor(minor / 100)},${String(minor % 100).padStart(2, "0")}`; }
export function PaymentDialog({ charge, today, open, onClose }: { charge: { id: string; clientId: string; clientName: string; description: string; amountMinor: number; amountPaidMinor: number; currency: "USD" | "ARS" }; today: string; open: boolean; onClose: () => void }) {
  const [state, action, pending] = useActionState(createPaymentAction, initial); const router = useRouter(); const dialog = useRef<HTMLDialogElement>(null); const balance = Math.max(charge.amountMinor - charge.amountPaidMinor, 0);
  useEffect(() => { const node = dialog.current; if (open && !node?.open) node?.showModal(); else if (!open && node?.open) node.close(); }, [open]);
  useEffect(() => { if (state.status === "success") { router.refresh(); onClose(); } }, [onClose, router, state.status]);
  return <dialog ref={dialog} className="payment-dialog" onCancel={(event) => { event.preventDefault(); onClose(); }} onClose={onClose}><header><div><p className="eyebrow">Registrar movimiento</p><h2>Pago de {charge.clientName}</h2><p>{charge.description}</p></div><button className="icon-button" type="button" aria-label="Cerrar registro de pago" onClick={onClose}><X size={18} /></button></header><form action={action} className="payment-form">
    <input type="hidden" name="chargeId" value={charge.id} /><input type="hidden" name="clientId" value={charge.clientId} /><input type="hidden" name="currency" value={charge.currency} />
    <div className="payment-balance"><span>Saldo pendiente</span><strong>{formatMoney(balance, charge.currency)}</strong></div>
    <label className="field-stack"><span>Monto</span><input autoFocus className="form-control" name="amount" inputMode="decimal" defaultValue={amountValue(balance)} aria-invalid={Boolean(state.fieldErrors?.amount)} /></label>
    <div className="form-grid form-grid--two"><label className="field-stack"><span>Fecha</span><input className="form-control" name="paymentDate" type="text" inputMode="numeric" placeholder="AAAA-MM-DD" defaultValue={today} /></label><label className="field-stack"><span>Método</span><LedgerSelect name="paymentMethod" label="Método de pago" defaultValue="bank_transfer" options={[{value:"bank_transfer",label:"Transferencia"},{value:"cash",label:"Efectivo"},{value:"mercadopago",label:"Mercado Pago"},{value:"paypal",label:"PayPal"},{value:"payoneer",label:"Payoneer"},{value:"stripe",label:"Stripe"},{value:"crypto",label:"Cripto"},{value:"other",label:"Otro"}]} /></label></div>
    <label className="field-stack"><span>Referencia</span><input className="form-control" name="reference" /></label><label className="field-stack"><span>Nota</span><textarea className="form-control form-textarea" name="notes" /></label>
    {state.status === "confirm_overpay" ? <label className="overpay-confirm"><input type="checkbox" name="confirmOverpay" required /><span><strong>Confirmar pago excedente</strong><small>{state.message}</small></span></label> : null}
    {state.status === "error" ? <p className="form-error" role="alert">{state.message}</p> : null}<footer><button className="quiet-button" type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : null}{state.status === "confirm_overpay" ? "Confirmar excedente" : "Registrar pago"}</button></footer>
  </form></dialog>;
}
