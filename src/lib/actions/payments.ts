"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { withAuthenticatedDb } from "@/db";
import { requireUser } from "@/lib/auth/require-user";
import { CancelledChargePaymentError, correctPayment, createPayment, PaymentMismatchError, PaymentOverpayConfirmationRequiredError } from "@/lib/services/payment-manager";
import { paymentFormSchema, paymentIdSchema } from "@/lib/validations/payment";

export interface PaymentActionState { status: "idle" | "error" | "success" | "confirm_overpay"; message?: string; chargeId?: string; paymentId?: string; clientId?: string; overpayMinor?: number; fieldErrors?: Record<string, string[]>; }
const input = (form: FormData) => ({ chargeId: form.get("chargeId"), clientId: form.get("clientId"), amount: form.get("amount"), currency: form.get("currency"), paymentDate: form.get("paymentDate"), paymentMethod: form.get("paymentMethod"), reference: form.get("reference"), notes: form.get("notes"), confirmOverpay: form.get("confirmOverpay") });
const invalid = (error: ZodError): PaymentActionState => ({ status: "error", message: "Revisá los campos indicados.", fieldErrors: error.flatten().fieldErrors });
function refresh(chargeId: string, clientId: string) { revalidatePath("/charges"); revalidatePath(`/charges/${chargeId}`); revalidatePath(`/clients/${clientId}/charges`); }
function safeError(error: unknown, values: { chargeId: string; clientId: string }): PaymentActionState {
  if (error instanceof PaymentOverpayConfirmationRequiredError) return { status: "confirm_overpay", chargeId: values.chargeId, clientId: values.clientId, overpayMinor: error.overpayMinor, message: "El pago supera el saldo pendiente. Confirmá para registrarlo igualmente." };
  if (error instanceof CancelledChargePaymentError) return { status: "error", message: "No se pueden registrar pagos en un cobro cancelado." };
  if (error instanceof PaymentMismatchError) return { status: "error", message: "El pago no coincide con el cliente o la moneda del cobro." };
  return { status: "error", message: "No pudimos registrar el pago." };
}

export async function createPaymentAction(_state: PaymentActionState, form: FormData): Promise<PaymentActionState> {
  const user = await requireUser(); const parsed = paymentFormSchema.safeParse(input(form)); if (!parsed.success) return invalid(parsed.error);
  try { const result = await withAuthenticatedDb(user.id, (db) => createPayment(db, { ownerId: user.id, values: parsed.data })); refresh(parsed.data.chargeId, parsed.data.clientId); return { status: "success", paymentId: result.id, chargeId: parsed.data.chargeId, clientId: parsed.data.clientId }; }
  catch (error) { return safeError(error, parsed.data); }
}

export async function correctPaymentAction(_state: PaymentActionState, form: FormData): Promise<PaymentActionState> {
  const user = await requireUser(); const id = paymentIdSchema.safeParse(form.get("paymentId")); const parsed = paymentFormSchema.safeParse(input(form)); if (!id.success || !parsed.success) return parsed.success ? { status: "error", message: "El pago no es válido." } : invalid(parsed.error);
  try { const result = await withAuthenticatedDb(user.id, (db) => correctPayment(db, { ownerId: user.id, paymentId: id.data, values: parsed.data })); refresh(parsed.data.chargeId, parsed.data.clientId); return { status: "success", paymentId: result.id, chargeId: parsed.data.chargeId, clientId: parsed.data.clientId }; }
  catch (error) { return safeError(error, parsed.data); }
}
