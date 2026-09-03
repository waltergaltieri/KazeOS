// @vitest-environment node

import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

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
import { deactivateServiceWithCharges } from "./service-manager";

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

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

interface CommittedFixture {
  clientId: string;
  ownerId: string;
  serviceId: string;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function openDatabaseSession() {
  const client = postgres(databaseUrl!, { prepare: false, max: 1 });

  return {
    client,
    database: drizzle({ client, schema }),
  };
}

async function backendPid(session: Database) {
  const rows = await session.execute(
    drizzleSql<{ pid: number }>`select pg_backend_pid()::integer as pid`,
  );
  const pid = rows[0]?.pid;

  if (typeof pid !== "number") throw new Error("Database backend pid was missing");
  return pid;
}

async function waitForRowLock(pid: number, operationSettled: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await database!.execute(drizzleSql<{
      wait_event_type: string | null;
    }>`
      select wait_event_type
      from pg_stat_activity
      where pid = ${pid}
    `);

    if (rows[0]?.wait_event_type === "Lock") return true;
    if (operationSettled()) return false;
    await delay(25);
  }

  return false;
}

async function createCommittedFixture(label: string): Promise<CommittedFixture> {
  const ownerId = randomUUID();
  const clientId = randomUUID();
  const serviceId = randomUUID();

  await database!.transaction(async (transaction) => {
    await transaction.execute(
      drizzleSql`insert into auth.users (id) values (${ownerId})`,
    );
    await transaction.insert(clients).values({
      firstName: `Concurrency ${label} ${ownerId}`,
      id: clientId,
      ownerId,
    });
    await transaction.insert(services).values({
      amountMinor: 10_000,
      automaticChargeGeneration: true,
      billingDay: 10,
      billingFrequency: "monthly",
      billingType: "recurring",
      clientId,
      currency: "USD",
      id: serviceId,
      name: `Concurrency ${label} ${serviceId}`,
      ownerId,
      startDate: "2026-09-01",
      status: "active",
    });
  });

  return { clientId, ownerId, serviceId };
}

async function cleanupCommittedFixture(fixture: CommittedFixture) {
  await database!.transaction(async (transaction) => {
    await transaction
      .delete(charges)
      .where(eq(charges.serviceId, fixture.serviceId));
    await transaction.delete(services).where(eq(services.id, fixture.serviceId));
    await transaction.delete(clients).where(eq(clients.id, fixture.clientId));
    await transaction.execute(
      drizzleSql`delete from auth.users where id = ${fixture.ownerId}`,
    );
  });

  const residue = await database!.execute(drizzleSql<{ count: number }>`
    select (
      (select count(*) from public.charges where service_id = ${fixture.serviceId}) +
      (select count(*) from public.services where id = ${fixture.serviceId}) +
      (select count(*) from public.clients where id = ${fixture.clientId}) +
      (select count(*) from auth.users where id = ${fixture.ownerId})
    )::integer as count
  `);

  expect(residue[0]?.count).toBe(0);
}

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
            ownerId: otherOwnerId,
          }),
        ).resolves.toEqual({
          candidates: 3,
          eligibleServices: 1,
          inserted: 3,
          skipped: 0,
        });
        await expect(
          generateRecurringCharges(transaction, {
            asOf: input.asOf,
            horizonMonths: input.horizonMonths,
            ownerId: otherOwnerId,
          }),
        ).resolves.toEqual({
          candidates: 3,
          eligibleServices: 1,
          inserted: 0,
          skipped: 3,
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

  it(
    "waits for an owner-scoped lifecycle mutation and rechecks eligibility after the lock",
    async () => {
      const fixture = await createCommittedFixture("lifecycle-first");
      const lifecycleSession = openDatabaseSession();
      const generatorSession = openDatabaseSession();
      const lifecycleChanged = createDeferred();
      const releaseLifecycle = createDeferred();
      let generatorSettled = false;

      try {
        const generatorPid = await backendPid(generatorSession.database);
        const lifecycle = lifecycleSession.database.transaction(
          async (transaction) => {
            await deactivateServiceWithCharges(transaction, {
              asOf: "2026-09-01",
              clientId: fixture.clientId,
              ownerId: fixture.ownerId,
              serviceId: fixture.serviceId,
              status: "paused",
            });
            lifecycleChanged.resolve();
            await releaseLifecycle.promise;
          },
        );
        await lifecycleChanged.promise;

        const runAsOwner = createAuthenticatedDrizzleRunner(
          generatorSession.database,
        );
        const generation = runAsOwner(fixture.ownerId, (transaction) =>
          generateRecurringCharges(transaction, {
            asOf: "2026-09-01",
            horizonMonths: 3,
            ownerId: fixture.ownerId,
            serviceId: fixture.serviceId,
          }),
        ).finally(() => {
          generatorSettled = true;
        });

        const observedLock = await waitForRowLock(
          generatorPid,
          () => generatorSettled,
        );
        releaseLifecycle.resolve();
        await lifecycle;

        expect(observedLock).toBe(true);
        await expect(generation).resolves.toEqual({
          candidates: 0,
          eligibleServices: 0,
          inserted: 0,
          skipped: 0,
        });

        const generatedRows = await database!
          .select({ id: charges.id })
          .from(charges)
          .where(eq(charges.serviceId, fixture.serviceId));
        expect(generatedRows).toHaveLength(0);
      } finally {
        releaseLifecycle.resolve();
        await Promise.allSettled([
          lifecycleSession.client.end(),
          generatorSession.client.end(),
        ]);
        await cleanupCommittedFixture(fixture);
      }
    },
    30_000,
  );

  it.each([
    { expectedChargeStatus: "pending", lifecycleStatus: "paused" },
    { expectedChargeStatus: "cancelled", lifecycleStatus: "cancelled" },
  ] as const)(
    "lets a $lifecycleStatus lifecycle mutation finish consistently after global generation",
    async ({ expectedChargeStatus, lifecycleStatus }) => {
      const fixture = await createCommittedFixture(`generator-first-${lifecycleStatus}`);
      const lifecycleSession = openDatabaseSession();
      const generatorSession = openDatabaseSession();
      const generationFinished = createDeferred();
      const releaseGeneration = createDeferred();
      let lifecycleSettled = false;

      try {
        const lifecyclePid = await backendPid(lifecycleSession.database);
        const generation = generatorSession.database.transaction(
          async (transaction) => {
            const result = await generateRecurringCharges(transaction, {
              asOf: "2026-09-01",
              horizonMonths: 3,
              serviceId: fixture.serviceId,
            });
            generationFinished.resolve();
            await releaseGeneration.promise;
            return result;
          },
        );
        await generationFinished.promise;

        const lifecycle = lifecycleSession.database
          .transaction((transaction) =>
            deactivateServiceWithCharges(transaction, {
              asOf: "2026-09-01",
              clientId: fixture.clientId,
              ownerId: fixture.ownerId,
              serviceId: fixture.serviceId,
              status: lifecycleStatus,
            }),
          )
          .finally(() => {
            lifecycleSettled = true;
          });
        const observedLock = await waitForRowLock(
          lifecyclePid,
          () => lifecycleSettled,
        );

        releaseGeneration.resolve();
        expect(observedLock).toBe(true);
        await expect(generation).resolves.toEqual({
          candidates: 3,
          eligibleServices: 1,
          inserted: 3,
          skipped: 0,
        });
        await lifecycle;

        const [service] = await database!
          .select({ status: services.status })
          .from(services)
          .where(eq(services.id, fixture.serviceId));
        const generatedRows = await database!
          .select({ status: charges.status })
          .from(charges)
          .where(eq(charges.serviceId, fixture.serviceId));
        expect(service?.status).toBe(lifecycleStatus);
        expect(generatedRows).toHaveLength(3);
        expect(generatedRows.every(({ status }) => status === expectedChargeStatus)).toBe(
          true,
        );
      } finally {
        releaseGeneration.resolve();
        await Promise.allSettled([
          lifecycleSession.client.end(),
          generatorSession.client.end(),
        ]);
        await cleanupCommittedFixture(fixture);
      }
    },
    30_000,
  );
});
