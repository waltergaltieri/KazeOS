import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/db/schema";
import { charges, services } from "@/db/schema";
import {
  buildChargePeriods,
  type RecurringServiceInput,
} from "@/lib/domain/recurrence";
import { validateCommercialDate } from "@/lib/domain/commercial-date";

export interface ChargeGenerationInput {
  asOf: string;
  horizonMonths?: number;
  ownerId?: string;
  serviceId?: string;
}

export interface ChargeGenerationResult {
  candidates: number;
  eligibleServices: number;
  inserted: number;
  skipped: number;
}

export type ChargeGeneratorDatabase = PostgresJsDatabase<typeof schema>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateInput(input: Readonly<ChargeGenerationInput>) {
  validateCommercialDate(input.asOf);

  const horizonMonths = input.horizonMonths ?? 3;

  if (!Number.isSafeInteger(horizonMonths) || horizonMonths < 1) {
    throw new RangeError("Horizon must be a positive safe number of months");
  }

  if (input.ownerId !== undefined && !uuidPattern.test(input.ownerId)) {
    throw new RangeError("Owner id must be a UUID");
  }

  if (input.serviceId !== undefined && !uuidPattern.test(input.serviceId)) {
    throw new RangeError("Service id must be a UUID");
  }

  return {
    horizonMonths,
    ownerId: input.ownerId,
    serviceId: input.serviceId,
  };
}

/**
 * Selects eligible services and inserts their missing charges. Callers provide
 * a transaction-bound database: normal application flows use
 * `withAuthenticatedDb`, while the protected cron facade uses an internal
 * admin transaction.
 */
export async function generateRecurringCharges(
  database: ChargeGeneratorDatabase,
  input: Readonly<ChargeGenerationInput>,
): Promise<ChargeGenerationResult> {
  const { horizonMonths, ownerId, serviceId } = validateInput(input);
  const eligible = await database
    .select({
      amountMinor: services.amountMinor,
      billingDay: services.billingDay,
      billingFrequency: services.billingFrequency,
      billingType: services.billingType,
      clientId: services.clientId,
      currency: services.currency,
      endDate: services.endDate,
      id: services.id,
      name: services.name,
      ownerId: services.ownerId,
      startDate: services.startDate,
      status: services.status,
    })
    .from(services)
    .where(
      and(
        eq(services.status, "active"),
        eq(services.billingType, "recurring"),
        ne(services.billingFrequency, "one_time"),
        eq(services.automaticChargeGeneration, true),
        ownerId === undefined ? undefined : eq(services.ownerId, ownerId),
        serviceId === undefined ? undefined : eq(services.id, serviceId),
      ),
    )
    .orderBy(asc(services.ownerId), asc(services.id));

  const values = eligible.flatMap((service) =>
    buildChargePeriods(
      service as RecurringServiceInput,
      input.asOf,
      horizonMonths,
    ).map((candidate) => ({
      amountMinor: candidate.amountMinor,
      amountPaidMinor: 0,
      clientId: service.clientId,
      currency: candidate.currency,
      description: candidate.description,
      dueDate: candidate.dueDate,
      generatedAutomatically: true,
      ownerId: service.ownerId,
      periodKey: candidate.periodKey,
      serviceId: service.id,
      status: "pending" as const,
    })),
  );

  if (values.length === 0) {
    return {
      candidates: 0,
      eligibleServices: eligible.length,
      inserted: 0,
      skipped: 0,
    };
  }

  const insertedRows = await database
    .insert(charges)
    .values(values)
    .onConflictDoNothing({
      target: [charges.serviceId, charges.periodKey],
      where: sql`${charges.serviceId} is not null and ${charges.periodKey} is not null`,
    })
    .returning({ id: charges.id });
  const inserted = insertedRows.length;

  return {
    candidates: values.length,
    eligibleServices: eligible.length,
    inserted,
    skipped: values.length - inserted,
  };
}
