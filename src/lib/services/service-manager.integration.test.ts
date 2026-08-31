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
      expect(rows.find((row) => row.periodKey === "monthly:2026-10")?.status).toBe("pending");
      expect(rows.find((row) => row.periodKey === "monthly:2026-11")?.status).toBe("pending");
    });
  }, 30_000);

  it("reconciles eligible September and October rows while November partial protects only itself", async () => {
    await withRollback(async (transaction) => {
      const ownerId = randomUUID();
      const clientId = randomUUID();
      await transaction.execute(sql`insert into auth.users (id) values (${ownerId})`);
      await transaction.insert(clients).values({ id: clientId, ownerId, firstName: "Reconciliación" });
      const [service] = await transaction.insert(services).values({
        ownerId,
        clientId,
        name: "Mantenimiento",
        description: null,
        amountMinor: 10_000,
        currency: "USD",
        billingType: "recurring",
        billingFrequency: "monthly",
        billingDay: 10,
        startDate: "2026-09-01",
        endDate: null,
        status: "active",
        automaticChargeGeneration: true,
      }).returning({ id: services.id });
      const serviceId = service!.id;
      const inserted = await transaction.insert(charges).values([
        { ownerId, clientId, serviceId, description: "Mantenimiento", periodKey: "monthly:2026-09", amountMinor: 10_000, currency: "USD", dueDate: "2026-09-10", status: "pending", generatedAutomatically: true },
        { ownerId, clientId, serviceId, description: "Mantenimiento", periodKey: "monthly:2026-10", amountMinor: 10_000, currency: "USD", dueDate: "2026-10-10", status: "pending", generatedAutomatically: true },
        { ownerId, clientId, serviceId, description: "Mantenimiento", periodKey: "monthly:2026-11", amountMinor: 10_000, currency: "USD", dueDate: "2026-11-10", status: "pending", generatedAutomatically: true },
      ]).returning({ id: charges.id, periodKey: charges.periodKey });
      const november = inserted.find((row) => row.periodKey === "monthly:2026-11")!;
      await transaction.insert(payments).values({
        ownerId,
        clientId,
        chargeId: november.id,
        amountMinor: 2_500,
        currency: "USD",
        paymentDate: "2026-09-01",
        paymentMethod: "bank_transfer",
      });
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);

      await runAsOwner(ownerId, (db) => updateServiceWithCharges(db, {
        asOf: "2026-09-01",
        clientId,
        ownerId,
        serviceId,
        values: {
          name: "Mantenimiento actualizado",
          description: null,
          amountMinor: 20_000,
          currency: "USD",
          billingType: "recurring",
          billingFrequency: "monthly",
          billingDay: 15,
          startDate: "2026-09-01",
          endDate: null,
          status: "active",
          automaticChargeGeneration: true,
        },
      }));

      const rows = await transaction.select().from(charges)
        .where(eq(charges.serviceId, serviceId)).orderBy(asc(charges.dueDate));
      expect(rows).toHaveLength(3);
      expect(rows.find((row) => row.periodKey === "monthly:2026-09")).toMatchObject({ amountMinor: 20_000, dueDate: "2026-09-15", status: "pending" });
      expect(rows.find((row) => row.periodKey === "monthly:2026-10")).toMatchObject({ amountMinor: 20_000, dueDate: "2026-10-15", status: "pending" });
      expect(rows.find((row) => row.periodKey === "monthly:2026-11")).toMatchObject({ amountMinor: 10_000, amountPaidMinor: 2_500, dueDate: "2026-11-10", status: "partial" });
    });
  }, 30_000);

  it("pauses without changing projections and reactivation fills the horizon idempotently", async () => {
    await withRollback(async (transaction) => {
      const ownerId = randomUUID();
      const clientId = randomUUID();
      await transaction.execute(sql`insert into auth.users (id) values (${ownerId})`);
      await transaction.insert(clients).values({ id: clientId, ownerId, firstName: "Pausa reversible" });
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);
      const values = {
        name: "Abono mensual",
        description: null,
        amountMinor: 10_000,
        currency: "USD" as const,
        billingType: "recurring" as const,
        billingFrequency: "monthly" as const,
        billingDay: 10,
        startDate: "2026-09-01",
        endDate: null,
        status: "active" as const,
        automaticChargeGeneration: true,
      };
      const created = await runAsOwner(ownerId, (db) => createServiceWithCharges(db, {
        asOf: "2026-09-01", clientId, ownerId, values,
      }));
      const beforePause = await transaction.select({ id: charges.id, periodKey: charges.periodKey, status: charges.status })
        .from(charges).where(eq(charges.serviceId, created.id)).orderBy(asc(charges.periodKey));

      await runAsOwner(ownerId, (db) => deactivateServiceWithCharges(db, {
        asOf: "2026-09-15", clientId, ownerId, serviceId: created.id, status: "paused",
      }));
      const whilePaused = await transaction.select({ id: charges.id, periodKey: charges.periodKey, status: charges.status })
        .from(charges).where(eq(charges.serviceId, created.id)).orderBy(asc(charges.periodKey));
      expect(whilePaused).toEqual(beforePause);
      await expect(runAsOwner(ownerId, (db) => generateRecurringCharges(db, {
        asOf: "2026-10-01", ownerId, serviceId: created.id,
      }))).resolves.toMatchObject({ eligibleServices: 0, inserted: 0 });

      const reactivate = () => runAsOwner(ownerId, (db) => updateServiceWithCharges(db, {
        asOf: "2026-10-01",
        clientId,
        ownerId,
        serviceId: created.id,
        values,
      }));
      await reactivate();
      await reactivate();
      const afterReactivation = await transaction.select({ periodKey: charges.periodKey, status: charges.status })
        .from(charges).where(eq(charges.serviceId, created.id)).orderBy(asc(charges.periodKey));
      expect(afterReactivation).toEqual([
        { periodKey: "monthly:2026-09", status: "pending" },
        { periodKey: "monthly:2026-10", status: "pending" },
        { periodKey: "monthly:2026-11", status: "pending" },
        { periodKey: "monthly:2026-12", status: "pending" },
      ]);
    });
  }, 30_000);

  it("makes cancellation terminal and cancels only eligible future automatic projections", async () => {
    await withRollback(async (transaction) => {
      const ownerId = randomUUID();
      const clientId = randomUUID();
      await transaction.execute(sql`insert into auth.users (id) values (${ownerId})`);
      await transaction.insert(clients).values({ id: clientId, ownerId, firstName: "Cancelación terminal" });
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);
      const values = {
        name: "Suscripción",
        description: null,
        amountMinor: 10_000,
        currency: "USD" as const,
        billingType: "recurring" as const,
        billingFrequency: "monthly" as const,
        billingDay: 10,
        startDate: "2026-08-01",
        endDate: null,
        status: "active" as const,
        automaticChargeGeneration: true,
      };
      const created = await runAsOwner(ownerId, (db) => createServiceWithCharges(db, {
        asOf: "2026-08-01", clientId, ownerId, values,
      }));
      const rows = await transaction.select().from(charges).where(eq(charges.serviceId, created.id));
      const september = rows.find((row) => row.periodKey === "monthly:2026-09")!;
      await transaction.insert(payments).values({
        ownerId, clientId, chargeId: september.id, amountMinor: 2_500,
        currency: "USD", paymentDate: "2026-09-01", paymentMethod: "bank_transfer",
      });
      await transaction.insert(charges).values({
        ownerId, clientId, serviceId: created.id, description: "Ajuste manual",
        periodKey: "manual:2026-12", amountMinor: 5_000, currency: "USD",
        dueDate: "2026-12-10", status: "pending", generatedAutomatically: false,
      });

      await runAsOwner(ownerId, (db) => deactivateServiceWithCharges(db, {
        asOf: "2026-09-01", clientId, ownerId, serviceId: created.id, status: "cancelled",
      }));
      const afterCancellation = await transaction.select({ periodKey: charges.periodKey, status: charges.status })
        .from(charges).where(eq(charges.serviceId, created.id)).orderBy(asc(charges.periodKey));
      expect(afterCancellation).toEqual([
        { periodKey: "manual:2026-12", status: "pending" },
        { periodKey: "monthly:2026-08", status: "pending" },
        { periodKey: "monthly:2026-09", status: "partial" },
        { periodKey: "monthly:2026-10", status: "cancelled" },
      ]);

      await expect(runAsOwner(ownerId, (db) => updateServiceWithCharges(db, {
        asOf: "2026-09-01", clientId, ownerId, serviceId: created.id, values,
      }))).rejects.toMatchObject({ name: "ServiceStatusLockedError" });
      const service = await transaction.query.services.findFirst({ where: eq(services.id, created.id) });
      expect(service?.status).toBe("cancelled");
      await expect(transaction.select({ periodKey: charges.periodKey, status: charges.status })
        .from(charges).where(eq(charges.serviceId, created.id)).orderBy(asc(charges.periodKey)))
        .resolves.toEqual(afterCancellation);
    });
  }, 30_000);
});
