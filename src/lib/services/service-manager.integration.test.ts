// @vitest-environment node

import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAuthenticatedDrizzleRunner } from "@/db/authenticated";
import * as schema from "@/db/schema";
import { charges, clients, payments, services } from "@/db/schema";

import {
  createServiceWithCharges,
  deactivateServiceWithCharges,
  ServiceCurrencyLockedError,
  updateServiceWithCharges,
} from "./service-manager";
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
const rollback = new Error("ROLLBACK_SERVICE_MANAGER_TEST");
type Database = NonNullable<typeof database>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function withRollback(operation: (transaction: Transaction) => Promise<void>) {
  try {
    await database!.transaction(async (transaction) => {
      await operation(transaction);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

afterAll(async () => databaseClient?.end());

describeDatabase("transactional service management", () => {
  it("creates three idempotent charges, reconciles eligible rows, and preserves history", async () => {
    await withRollback(async (transaction) => {
      const ownerId = randomUUID();
      const clientId = randomUUID();
      await transaction.execute(sql`insert into auth.users (id) values (${ownerId})`);
      await transaction.insert(clients).values({
        id: clientId,
        ownerId,
        firstName: "Acuerdo recurrente",
      });
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);

      const created = await runAsOwner(ownerId, (db) =>
        createServiceWithCharges(db, {
          asOf: "2026-08-31",
          clientId,
          ownerId,
          values: {
            name: "Soporte mensual",
            description: null,
            amountMinor: 10_000,
            currency: "USD",
            billingType: "recurring",
            billingFrequency: "monthly",
            billingDay: 31,
            startDate: "2026-08-31",
            endDate: null,
            status: "active",
            automaticChargeGeneration: true,
          },
        }),
      );

      expect(created.generated).toMatchObject({ inserted: 3, skipped: 0 });
      await expect(
        runAsOwner(ownerId, (db) =>
          generateRecurringCharges(db, {
            asOf: "2026-08-31",
            ownerId,
            serviceId: created.id,
          }),
        ),
      ).resolves.toMatchObject({ inserted: 0, skipped: 3 });

      let rows = await transaction
        .select()
        .from(charges)
        .where(eq(charges.serviceId, created.id))
        .orderBy(asc(charges.dueDate));
      expect(rows.map((row) => row.dueDate)).toEqual([
        "2026-08-31",
        "2026-09-30",
        "2026-10-31",
      ]);

      const september = rows[1]!;
      await transaction.insert(payments).values({
        ownerId,
        clientId,
        chargeId: september.id,
        amountMinor: 2_500,
        currency: "USD",
        paymentDate: "2026-09-01",
        paymentMethod: "bank_transfer",
      });

      await expect(runAsOwner(ownerId, (db) =>
        updateServiceWithCharges(db, {
          asOf: "2026-09-01",
          clientId,
          ownerId,
          serviceId: created.id,
          values: {
            name: "Soporte actualizado",
            description: null,
            amountMinor: 20_000,
            currency: "ARS",
            billingType: "recurring",
            billingFrequency: "monthly",
            billingDay: 15,
            startDate: "2026-08-31",
            endDate: null,
            status: "active",
            automaticChargeGeneration: true,
          },
        }),
      )).rejects.toBeInstanceOf(ServiceCurrencyLockedError);

      const unchangedAfterCurrencyAttempt = await transaction
        .select({ currency: services.currency })
        .from(services)
        .where(eq(services.id, created.id));
      expect(unchangedAfterCurrencyAttempt[0]?.currency).toBe("USD");

      await runAsOwner(ownerId, (db) =>
        updateServiceWithCharges(db, {
          asOf: "2026-09-01",
          clientId,
          ownerId,
          serviceId: created.id,
          values: {
            name: "Soporte actualizado",
            description: null,
            amountMinor: 20_000,
            currency: "USD",
            billingType: "recurring",
            billingFrequency: "monthly",
            billingDay: 15,
            startDate: "2026-08-31",
            endDate: null,
            status: "active",
            automaticChargeGeneration: true,
          },
        }),
      );

      rows = await transaction
        .select()
        .from(charges)
        .where(eq(charges.serviceId, created.id))
        .orderBy(asc(charges.dueDate));
      const augustAfter = rows.find((row) => row.periodKey === "monthly:2026-08")!;
      const septemberAfter = rows.find((row) => row.periodKey === "monthly:2026-09")!;
      const octoberAfter = rows.find((row) => row.periodKey === "monthly:2026-10")!;
      const novemberAfter = rows.find((row) => row.periodKey === "monthly:2026-11")!;

      expect(augustAfter).toMatchObject({ amountMinor: 10_000, currency: "USD", dueDate: "2026-08-31", status: "pending" });
      expect(septemberAfter).toMatchObject({ amountMinor: 10_000, amountPaidMinor: 2_500, currency: "USD", dueDate: "2026-09-30", status: "partial" });
      expect(octoberAfter).toMatchObject({ amountMinor: 20_000, currency: "USD", dueDate: "2026-10-15", status: "pending" });
      expect(novemberAfter).toMatchObject({ amountMinor: 20_000, currency: "USD", dueDate: "2026-11-15", status: "pending" });
      expect(rows).toHaveLength(4);

      await runAsOwner(ownerId, (db) =>
        deactivateServiceWithCharges(db, {
          asOf: "2026-09-01",
          clientId,
          ownerId,
          serviceId: created.id,
          status: "paused",
        }),
      );

      const service = await transaction.query.services.findFirst({
        where: eq(services.id, created.id),
      });
      expect(service?.status).toBe("paused");
      rows = await transaction
        .select()
        .from(charges)
        .where(eq(charges.serviceId, created.id));
      expect(rows.find((row) => row.periodKey === "monthly:2026-08")?.status).toBe("pending");
      expect(rows.find((row) => row.periodKey === "monthly:2026-09")?.status).toBe("partial");
      expect(rows.find((row) => row.periodKey === "monthly:2026-10")?.status).toBe("cancelled");
      expect(rows.find((row) => row.periodKey === "monthly:2026-11")?.status).toBe("cancelled");
    });
  }, 30_000);
});
