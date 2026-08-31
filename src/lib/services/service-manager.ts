import {
  and,
  asc,
  eq,
  gte,
  inArray,
} from "drizzle-orm";

import { charges, services } from "@/db/schema";
import { buildChargePeriods } from "@/lib/domain/recurrence";
import type { ServiceFormValues } from "@/lib/validations/service";

import {
  generateRecurringCharges,
  type ChargeGenerationResult,
  type ChargeGeneratorDatabase,
} from "./charge-generator";

interface ServiceScope {
  asOf: string;
  clientId: string;
  ownerId: string;
}

export interface CreateServiceInput extends ServiceScope {
  values: ServiceFormValues;
}

export interface UpdateServiceInput extends ServiceScope {
  serviceId: string;
  values: ServiceFormValues;
}

export interface DeactivateServiceInput extends ServiceScope {
  serviceId: string;
  status: "paused" | "cancelled";
}

export interface ServiceMutationResult {
  id: string;
  generated: ChargeGenerationResult;
}

export class ServiceCurrencyLockedError extends Error {
  constructor() {
    super("Service currency cannot change after charges exist");
    this.name = "ServiceCurrencyLockedError";
  }
}

const emptyGenerationResult = (): ChargeGenerationResult => ({
  candidates: 0,
  eligibleServices: 0,
  inserted: 0,
  skipped: 0,
});

function serviceWhere(input: {
  clientId: string;
  ownerId: string;
  serviceId: string;
}) {
  return and(
    eq(services.id, input.serviceId),
    eq(services.clientId, input.clientId),
    eq(services.ownerId, input.ownerId),
  );
}

function futureChargeWhere(input: {
  asOf: string;
  clientId: string;
  ownerId: string;
  serviceId: string;
}) {
  return and(
    eq(charges.ownerId, input.ownerId),
    eq(charges.clientId, input.clientId),
    eq(charges.serviceId, input.serviceId),
    gte(charges.dueDate, input.asOf),
  );
}

export async function createServiceWithCharges(
  database: ChargeGeneratorDatabase,
  input: Readonly<CreateServiceInput>,
): Promise<ServiceMutationResult> {
  const [created] = await database
    .insert(services)
    .values({
      ...input.values,
      clientId: input.clientId,
      ownerId: input.ownerId,
    })
    .returning({ id: services.id });

  if (!created) throw new Error("Service insert did not return an id");

  const generated = await generateRecurringCharges(database, {
    asOf: input.asOf,
    horizonMonths: 3,
    ownerId: input.ownerId,
    serviceId: created.id,
  });

  return { id: created.id, generated };
}

export async function updateServiceWithCharges(
  database: ChargeGeneratorDatabase,
  input: Readonly<UpdateServiceInput>,
): Promise<ServiceMutationResult> {
  const [current] = await database
    .select({ currency: services.currency, id: services.id })
    .from(services)
    .where(serviceWhere(input))
    .limit(1)
    .for("update");

  if (!current) throw new Error("Service was not found");

  if (current.currency !== input.values.currency) {
    const [linkedCharge] = await database
      .select({ id: charges.id })
      .from(charges)
      .where(
        and(
          eq(charges.ownerId, input.ownerId),
          eq(charges.clientId, input.clientId),
          eq(charges.serviceId, input.serviceId),
        ),
      )
      .limit(1);

    if (linkedCharge) throw new ServiceCurrencyLockedError();
  }

  await database
    .update(services)
    .set({ ...input.values, updatedAt: new Date() })
    .where(serviceWhere(input));

  const existing = await database
    .select({
      amountPaidMinor: charges.amountPaidMinor,
      dueDate: charges.dueDate,
      generatedAutomatically: charges.generatedAutomatically,
      id: charges.id,
      periodKey: charges.periodKey,
      status: charges.status,
    })
    .from(charges)
    .where(futureChargeWhere(input))
    .orderBy(asc(charges.dueDate), asc(charges.id));

  const immutableProtectionDate = existing
    .filter(
      (charge) =>
        charge.status !== "cancelled" &&
        (charge.status !== "pending" || charge.amountPaidMinor !== 0),
    )
    .reduce<string | undefined>(
      (latest, charge) =>
        latest === undefined || charge.dueDate > latest
          ? charge.dueDate
          : latest,
      undefined,
    );

  const canGenerate =
    input.values.status === "active" &&
    input.values.billingType === "recurring" &&
    input.values.automaticChargeGeneration;
  const candidates = canGenerate
    ? buildChargePeriods(input.values, input.asOf, 3).filter(
        (candidate) =>
          immutableProtectionDate === undefined ||
          candidate.dueDate > immutableProtectionDate,
      )
    : [];
  const candidatesByPeriod = new Map(
    candidates.map((candidate) => [candidate.periodKey, candidate]),
  );
  const mutable = existing.filter(
    (charge) =>
      charge.generatedAutomatically &&
      charge.status === "pending" &&
      charge.amountPaidMinor === 0,
  );

  for (const charge of mutable) {
    const candidate = charge.periodKey
      ? candidatesByPeriod.get(charge.periodKey)
      : undefined;

    if (!candidate) continue;

    await database
      .update(charges)
      .set({
        amountMinor: candidate.amountMinor,
        currency: candidate.currency,
        description: candidate.description,
        dueDate: candidate.dueDate,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(charges.id, charge.id),
          eq(charges.ownerId, input.ownerId),
          eq(charges.status, "pending"),
          eq(charges.amountPaidMinor, 0),
        ),
      );
  }

  const obsoleteIds = mutable
    .filter(
      (charge) =>
        charge.periodKey === null || !candidatesByPeriod.has(charge.periodKey),
    )
    .map((charge) => charge.id);

  if (obsoleteIds.length > 0) {
    await database
      .update(charges)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          inArray(charges.id, obsoleteIds),
          eq(charges.ownerId, input.ownerId),
          eq(charges.status, "pending"),
          eq(charges.amountPaidMinor, 0),
        ),
      );
  }

  const generated = canGenerate
    ? await generateRecurringCharges(database, {
        afterDateExclusive: immutableProtectionDate,
        asOf: input.asOf,
        horizonMonths: 3,
        ownerId: input.ownerId,
        serviceId: input.serviceId,
      })
    : emptyGenerationResult();

  return { id: input.serviceId, generated };
}

export async function deactivateServiceWithCharges(
  database: ChargeGeneratorDatabase,
  input: Readonly<DeactivateServiceInput>,
): Promise<ServiceMutationResult> {
  const updated = await database
    .update(services)
    .set({ status: input.status, updatedAt: new Date() })
    .where(serviceWhere(input))
    .returning({ id: services.id });

  if (!updated[0]) throw new Error("Service was not found");

  await database
    .update(charges)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        futureChargeWhere(input),
        eq(charges.generatedAutomatically, true),
        eq(charges.status, "pending"),
        eq(charges.amountPaidMinor, 0),
      ),
    );

  return { id: input.serviceId, generated: emptyGenerationResult() };
}
