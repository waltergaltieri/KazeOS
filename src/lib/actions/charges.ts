"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";
import { withAuthenticatedDb } from "@/db";
import { requireUser } from "@/lib/auth/require-user";
import { cancelManualCharge, ChargeFinanciallyLockedError, createManualCharge, updateManualCharge } from "@/lib/services/charge-manager";
import { chargeFormSchema, chargeIdSchema } from "@/lib/validations/charge";

export interface ChargeActionState { status: "idle" | "error" | "success"; message?: string; chargeId?: string; clientId?: string; fieldErrors?: Record<string, string[]>; }
const input = (form: FormData) => ({ clientId: form.get("clientId"), description: form.get("description"), amount: form.get("amount"), currency: form.get("currency"), dueDate: form.get("dueDate"), notes: form.get("notes") });
const invalid = (error: ZodError): ChargeActionState => ({ status: "error", message: "Revisá los campos indicados.", fieldErrors: error.flatten().fieldErrors });
function refresh(clientId?: string) { revalidatePath("/charges"); if (clientId) revalidatePath(`/clients/${clientId}/charges`); }

export async function createChargeAction(_state: ChargeActionState, form: FormData): Promise<ChargeActionState> {
  const user = await requireUser(); const parsed = chargeFormSchema.safeParse(input(form)); if (!parsed.success) return invalid(parsed.error);
  try { const result = await withAuthenticatedDb(user.id, (db) => createManualCharge(db, { ownerId: user.id, values: parsed.data })); refresh(result.clientId); return { status: "success", chargeId: result.id, clientId: result.clientId }; }
  catch { return { status: "error", message: "No pudimos crear el cobro." }; }
}

export async function updateChargeAction(_state: ChargeActionState, form: FormData): Promise<ChargeActionState> {
  const user = await requireUser(); const id = chargeIdSchema.safeParse(form.get("chargeId")); const parsed = chargeFormSchema.safeParse(input(form)); if (!id.success || !parsed.success) return parsed.success ? { status: "error", message: "El cobro no es válido." } : invalid(parsed.error);
  try { const result = await withAuthenticatedDb(user.id, (db) => updateManualCharge(db, { ownerId: user.id, chargeId: id.data, values: parsed.data })); refresh(result.clientId); return { status: "success", chargeId: result.id, clientId: result.clientId }; }
  catch (error) { return error instanceof ChargeFinanciallyLockedError ? { status: "error", message: "Este cobro ya tiene movimientos o es automático y no se puede editar." } : { status: "error", message: "No pudimos actualizar el cobro." }; }
}

export async function cancelChargeAction(_state: ChargeActionState, form: FormData): Promise<ChargeActionState> {
  const user = await requireUser(); const id = chargeIdSchema.safeParse(form.get("chargeId")); if (!id.success) return { status: "error", message: "El cobro no es válido." };
  try { const result = await withAuthenticatedDb(user.id, (db) => cancelManualCharge(db, { ownerId: user.id, chargeId: id.data })); refresh(result.clientId); return { status: "success", chargeId: result.id, clientId: result.clientId }; }
  catch (error) { return error instanceof ChargeFinanciallyLockedError ? { status: "error", message: "Solo se puede cancelar un cobro manual sin pagos." } : { status: "error", message: "No pudimos cancelar el cobro." }; }
}
