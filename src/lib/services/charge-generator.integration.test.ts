// @vitest-environment node

import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { asc, eq, sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as schema from "@/db/schema";
import { charges, clients, services } from "@/db/schema";
import { createAuthenticatedDrizzleRunner } from "@/db/authenticated";

import { generateRecurringCharges } from "./charge-generator";

config({ path: ".env.local", quiet: true });

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const databaseClient = databaseUrl
  ? postgres(databaseUrl, { prepare: false, max: 1 })
  : undefined;
const database = databaseClient
  ? drizzle({ client: databaseClient, schema })
  : undefined;
const rollback = new Error("ROLLBACK_CHARGE_GENERATOR_TEST");
type Database = NonNullable<typeof database>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function withRollback(
  operation: (transaction: Transaction) => Promise<void>,
) {
  try {
    await database!.transaction(async (transaction) => {
      await operation(transaction);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) {
      throw error;
    }
  }
}

async function seedOwner(
  transaction: Transaction,
  ownerId: string,
) {
  const clientId = randomUUID();

  await transaction.execute(
    drizzleSql`insert into auth.users (id) values (${ownerId})`,
  );
  await transaction.insert(clients).values({
    firstName: "Recurrence test",
    id: clientId,
    ownerId,
  });

  return clientId;
}

async function seedService(
  transaction: Transaction,
  input: {
    ownerId: string;
    clientId: string;
    status?: "active" | "paused";
    automatic?: boolean;
  },
) {
  const serviceId = randomUUID();

  await transaction.insert(services).values({
    amountMinor: 10_000,
    automaticChargeGeneration: input.automatic ?? true,
    billingDay: 31,
    billingFrequency: "monthly",
    billingType: "recurring",
    clientId: input.clientId,
    currency: "USD",
    id: serviceId,
    name: "Monthly care",
    ownerId: input.ownerId,
    startDate: "2026-01-31",
    status: input.status ?? "active",
  });

  return serviceId;
}

afterAll(async () => {
  await databaseClient?.end();
});

describeDatabase("generateRecurringCharges", () => {
  it(
    "is owner-scoped, transactional, and idempotent",
    async () => {
      await withRollback(async (transaction) => {
        const ownerId = randomUUID();
        const otherOwnerId = randomUUID();
        const clientId = await seedOwner(transaction, ownerId);
        const otherClientId = await seedOwner(transaction, otherOwnerId);
        const serviceId = await seedService(transaction, { ownerId, clientId });

        await seedService(transaction, {
          ownerId,
          clientId,
          automatic: false,
        });
        await seedService(transaction, {
          ownerId,
          clientId,
          status: "paused",
        });
        await seedService(transaction, {
          ownerId: otherOwnerId,
          clientId: otherClientId,
        });

        const input = { asOf: "2026-01-31", horizonMonths: 3, ownerId };

        await expect(
          generateRecurringCharges(transaction, input),
        ).resolves.toEqual({
          candidates: 3,
          eligibleServices: 1,
          inserted: 3,
          skipped: 0,
        });
        await expect(
          generateRecurringCharges(transaction, input),
        ).resolves.toEqual({
          candidates: 3,
          eligibleServices: 1,
          inserted: 0,
          skipped: 3,
        });
        await expect(
          generateRecurringCharges(transaction, {
            asOf: input.asOf,
            horizonMonths: input.horizonMonths,
          }),
        ).resolves.toEqual({
          candidates: 6,
          eligibleServices: 2,
          inserted: 3,
          skipped: 3,
        });
        await expect(
          generateRecurringCharges(transaction, {
            asOf: input.asOf,
            horizonMonths: input.horizonMonths,
          }),
        ).resolves.toEqual({
          candidates: 6,
          eligibleServices: 2,
          inserted: 0,
          skipped: 6,
        });

        const rows = await transaction
          .select({
            due_date: charges.dueDate,
            generated_automatically: charges.generatedAutomatically,
            period_key: charges.periodKey,
            service_id: charges.serviceId,
          })
          .from(charges)
          .where(eq(charges.ownerId, ownerId))
          .orderBy(asc(charges.dueDate));

        expect(rows).toEqual([
          {
            due_date: "2026-01-31",
            generated_automatically: true,
            period_key: "monthly:2026-01",
            service_id: serviceId,
          },
          {
            due_date: "2026-02-28",
            generated_automatically: true,
            period_key: "monthly:2026-02",
            service_id: serviceId,
          },
          {
            due_date: "2026-03-31",
            generated_automatically: true,
            period_key: "monthly:2026-03",
            service_id: serviceId,
          },
        ]);

        const runAsOwner = createAuthenticatedDrizzleRunner(transaction);

        await expect(
          runAsOwner(ownerId, (scopedDatabase) =>
            generateRecurringCharges(scopedDatabase, {
              asOf: input.asOf,
              horizonMonths: input.horizonMonths,
            }),
          ),
        ).resolves.toEqual({
          candidates: 3,
          eligibleServices: 1,
          inserted: 0,
          skipped: 3,
        });
      });
    },
    30_000,
  );
});
