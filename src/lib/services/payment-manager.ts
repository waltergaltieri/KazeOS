import { and, eq } from "drizzle-orm";

import { charges, payments } from "@/db/schema";
import type { PaymentFormValues } from "@/lib/validations/payment";
import type { ChargeGeneratorDatabase } from "./charge-generator";

export class PaymentChargeNotFoundError extends Error {}
export class PaymentMismatchError extends Error {}
export class CancelledChargePaymentError extends Error {}
export class PaymentOverpayConfirmationRequiredError extends Error {
  constructor(public readonly overpayMinor: number) { super("Overpay confirmation required"); }
}
export class PaymentNotFoundError extends Error {}

async function lockCharge(database: ChargeGeneratorDatabase, input: { ownerId: string; chargeId: string }) {
  const [charge] = await database.select({ id: charges.id, clientId: charges.clientId, currency: charges.currency, amountMinor: charges.amountMinor, amountPaidMinor: charges.amountPaidMinor, status: charges.status }).from(charges).where(and(eq(charges.id, input.chargeId), eq(charges.ownerId, input.ownerId))).limit(1).for("update");
  if (!charge) throw new PaymentChargeNotFoundError();
  if (charge.status === "cancelled") throw new CancelledChargePaymentError();
  return charge;
}

function assertPayment(charge: Awaited<ReturnType<typeof lockCharge>>, values: PaymentFormValues, currentPaymentMinor = 0) {
  if (charge.clientId !== values.clientId || charge.currency !== values.currency) throw new PaymentMismatchError();
  const projectedTotal = charge.amountPaidMinor - currentPaymentMinor + values.amountMinor;
  if (!Number.isSafeInteger(projectedTotal)) throw new PaymentMismatchError();
  if (projectedTotal > charge.amountMinor && !values.confirmOverpay) throw new PaymentOverpayConfirmationRequiredError(projectedTotal - charge.amountMinor);
}

export async function createPayment(database: ChargeGeneratorDatabase, input: { ownerId: string; values: PaymentFormValues }) {
  const charge = await lockCharge(database, { ownerId: input.ownerId, chargeId: input.values.chargeId });
  assertPayment(charge, input.values);
  const [created] = await database.insert(payments).values({ ownerId: input.ownerId, clientId: input.values.clientId, chargeId: input.values.chargeId, amountMinor: input.values.amountMinor, currency: input.values.currency, paymentDate: input.values.paymentDate, paymentMethod: input.values.paymentMethod, reference: input.values.reference, notes: input.values.notes }).returning({ id: payments.id, chargeId: payments.chargeId });
  if (!created) throw new Error("Payment insert did not return a row");
  return created;
}

export async function correctPayment(database: ChargeGeneratorDatabase, input: { ownerId: string; paymentId: string; values: PaymentFormValues }) {
  const charge = await lockCharge(database, { ownerId: input.ownerId, chargeId: input.values.chargeId });
  const [payment] = await database.select({ id: payments.id, amountMinor: payments.amountMinor, chargeId: payments.chargeId, clientId: payments.clientId, currency: payments.currency }).from(payments).where(and(eq(payments.id, input.paymentId), eq(payments.ownerId, input.ownerId))).limit(1);
  if (!payment) throw new PaymentNotFoundError();
  if (payment.chargeId !== input.values.chargeId || payment.clientId !== input.values.clientId || payment.currency !== input.values.currency) throw new PaymentMismatchError();
  assertPayment(charge, input.values, payment.amountMinor);
  const [updated] = await database.update(payments).set({ amountMinor: input.values.amountMinor, paymentDate: input.values.paymentDate, paymentMethod: input.values.paymentMethod, reference: input.values.reference, notes: input.values.notes, updatedAt: new Date() }).where(and(eq(payments.id, input.paymentId), eq(payments.ownerId, input.ownerId), eq(payments.chargeId, input.values.chargeId))).returning({ id: payments.id, chargeId: payments.chargeId });
  if (!updated) throw new PaymentNotFoundError();
  return updated;
}
