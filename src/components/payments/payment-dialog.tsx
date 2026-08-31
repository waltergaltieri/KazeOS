"use client";
import { LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { correctPaymentAction, createPaymentAction, type PaymentActionState } from "@/lib/actions/payments";
import { formatMoney, parseMoneyInput } from "@/lib/domain/money";
import { LedgerSelect } from "@/components/ui/ledger-select";
const initial: PaymentActionState = { status: "idle" };
function amountValue(minor: number) { return `${Math.floor(minor / 100)},${String(minor % 100).padStart(2, "0")}`; }

export interface PaymentDialogCharge { id: string; clientId: string; clientName: string; description: string; amountMinor: number; amountPaidMinor: number; currency: "USD" | "ARS" }
export interface EditablePayment { id: string; amountMinor: number; paymentDate: string; paymentMethod: string; reference: string | null; notes: string | null }

const methods = [{value:"bank_transfer",label:"Transferencia"},{value:"cash",label:"Efectivo"},{value:"mercadopago",label:"Mercado Pago"},{value:"paypal",label:"PayPal"},{value:"payoneer",label:"Payoneer"},{value:"stripe",label:"Stripe"},{value:"crypto",label:"Cripto"},{value:"other",label:"Otro"}];

export function PaymentDialog({ charge, payment, today, open, onClose }: { charge: PaymentDialogCharge; payment?: EditablePayment; today: string; open: boolean; onClose: () => void }) {
  const correction = Boolean(payment);
  const [state, action, pending] = useActionState(correction ? correctPaymentAction : createPaymentAction, initial);
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const titleId = useId();
  const descriptionId = useId();
  const balance = Math.max(charge.amountMinor - charge.amountPaidMinor, 0);
  const allowedWithoutConfirmation = Math.max(0, balance + (payment?.amountMinor ?? 0));
  const [enteredAmount, setEnteredAmount] = useState(amountValue(payment?.amountMinor ?? balance));
  let parsedAmount = 0;
  try { parsedAmount = parseMoneyInput(enteredAmount); } catch { parsedAmount = 0; }
  const showOverpay = state.status === "confirm_overpay" && parsedAmount > allowedWithoutConfirmation;

  useEffect(() => {
    const target = opener.current;
    return () => {
      requestAnimationFrame(() => { if (target?.isConnected) target.focus(); });
    };
  }, []);
  useEffect(() => { const node = dialog.current; if (open && !node?.open) node?.showModal(); else if (!open && node?.open) node.close(); }, [open]);
  useEffect(() => { if (state.status === "success") { router.refresh(); onClose(); } }, [onClose, router, state.status]);

  function close() {
    const node = dialog.current;
    if (node?.open) node.close(); else onClose();
  }

  const title = `${correction ? "Corregir" : "Registrar"} pago de ${charge.clientName}`;
  const context = `${charge.description}. Saldo pendiente ${formatMoney(balance, charge.currency)}.`;

  return <dialog ref={dialog} className="payment-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { event.preventDefault(); close(); }} onClose={onClose}><header><div><p className="eyebrow">{correction ? "Corregir movimiento" : "Registrar movimiento"}</p><h2 id={titleId}>{title}</h2><p aria-hidden="true">{charge.description}</p><p id={descriptionId} className="sr-only">{context}</p></div><button className="icon-button" type="button" aria-label={`Cerrar ${correction ? "corrección" : "registro"} de pago`} onClick={close}><X size={18} /></button></header><form action={action} className="payment-form">
    {payment ? <input type="hidden" name="paymentId" value={payment.id} /> : null}<input type="hidden" name="chargeId" value={charge.id} /><input type="hidden" name="clientId" value={charge.clientId} /><input type="hidden" name="currency" value={charge.currency} />
    <div className="payment-balance"><span>{correction ? "Disponible sin excedente" : "Saldo pendiente"}</span><strong>{formatMoney(allowedWithoutConfirmation, charge.currency)}</strong></div>
    <label className="field-stack"><span>Monto</span><input autoFocus className="form-control" name="amount" inputMode="decimal" value={enteredAmount} onChange={(event) => setEnteredAmount(event.target.value)} aria-invalid={Boolean(state.fieldErrors?.amount)} />{state.fieldErrors?.amount?.[0] ? <small className="field-error">{state.fieldErrors.amount[0]}</small> : null}</label>
    <div className="form-grid form-grid--two"><label className="field-stack"><span>Fecha</span><input className="form-control" name="paymentDate" type="text" inputMode="numeric" placeholder="AAAA-MM-DD" defaultValue={payment?.paymentDate ?? today} /></label><label className="field-stack"><span>Método</span><LedgerSelect name="paymentMethod" label="Método de pago" defaultValue={payment?.paymentMethod ?? "bank_transfer"} options={methods} /></label></div>
    <label className="field-stack"><span>Referencia</span><input className="form-control" name="reference" defaultValue={payment?.reference ?? ""} /></label><label className="field-stack"><span>Nota</span><textarea className="form-control form-textarea" name="notes" defaultValue={payment?.notes ?? ""} /></label>
    {showOverpay ? <label className="overpay-confirm"><input type="checkbox" name="confirmOverpay" required /><span><strong>Confirmar pago excedente</strong><small>{state.message}</small></span></label> : null}
    {state.status === "error" ? <p className="form-error" role="alert">{state.message}</p> : null}<footer><button className="quiet-button" type="button" onClick={close}>Cancelar</button><button className="primary-button" type="submit" disabled={pending}>{pending ? <LoaderCircle className="spin" size={16} /> : null}{showOverpay ? "Confirmar excedente" : correction ? "Guardar corrección" : "Registrar pago"}</button></footer>
  </form></dialog>;
}
