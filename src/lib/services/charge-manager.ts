import { and, eq } from "drizzle-orm";

import { charges, clients } from "@/db/schema";
import type { ChargeFormValues } from "@/lib/validations/charge";
import type { ChargeGeneratorDatabase } from "./charge-generator";

export class ChargeNotFoundError extends Error {}
export class ChargeFinanciallyLockedError extends Error {}

type Scope = { ownerId: string; chargeId: string };

export async function createManualCharge(database: ChargeGeneratorDatabase, input: { ownerId: string; values: ChargeFormValues }) {
  const [client] = await database.select({ id: clients.id }).from(clients).where(and(eq(clients.id, input.values.clientId), eq(clients.ownerId, input.ownerId))).limit(1);
  if (!client) throw new ChargeNotFoundError();
  const [created] = await database.insert(charges).values({ ownerId: input.ownerId, clientId: input.values.clientId, description: input.values.description, amountMinor: input.values.amountMinor, currency: input.values.currency, dueDate: input.values.dueDate, generatedAutomatically: false }).returning({ id: charges.id, clientId: charges.clientId });
  if (!created) throw new Error("Charge insert did not return a row");
  return created;
}

async function lockManualCharge(database: ChargeGeneratorDatabase, scope: Scope) {
  const [current] = await database.select({ id: charges.id, clientId: charges.clientId, generatedAutomatically: charges.generatedAutomatically, status: charges.status, amountPaidMinor: charges.amountPaidMinor }).from(charges).where(and(eq(charges.id, scope.chargeId), eq(charges.ownerId, scope.ownerId))).limit(1).for("update");
  if (!current) throw new ChargeNotFoundError();
  if (current.generatedAutomatically || current.status !== "pending" || current.amountPaidMinor !== 0) throw new ChargeFinanciallyLockedError();
  return current;
}

export async function updateManualCharge(database: ChargeGeneratorDatabase, input: Scope & { values: ChargeFormValues }) {
  const current = await lockManualCharge(database, input);
  if (current.clientId !== input.values.clientId) throw new ChargeFinanciallyLockedError();
  const [updated] = await database.update(charges).set({ description: input.values.description, amountMinor: input.values.amountMinor, currency: input.values.currency, dueDate: input.values.dueDate, updatedAt: new Date() }).where(and(eq(charges.id, input.chargeId), eq(charges.ownerId, input.ownerId), eq(charges.status, "pending"), eq(charges.amountPaidMinor, 0))).returning({ id: charges.id, clientId: charges.clientId });
  if (!updated) throw new ChargeFinanciallyLockedError();
  return updated;
}

export async function cancelManualCharge(database: ChargeGeneratorDatabase, input: Scope) {
  const current = await lockManualCharge(database, input);
  const [updated] = await database.update(charges).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(charges.id, input.chargeId), eq(charges.ownerId, input.ownerId), eq(charges.status, "pending"), eq(charges.amountPaidMinor, 0))).returning({ id: charges.id, clientId: charges.clientId });
  if (!updated) throw new ChargeFinanciallyLockedError();
  return { ...updated, previous: current };
}
