// @vitest-environment node

import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAuthenticatedDrizzleRunner } from "@/db/authenticated";
import * as schema from "@/db/schema";
import { charges, clients, payments, services } from "@/db/schema";

config({ path: ".env.local", quiet: true });
const { queryChargeSummary, queryCharges } = await import("./charges");
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? postgres(databaseUrl, { prepare: false, max: 1 }) : undefined;
const database = client ? drizzle({ client, schema }) : undefined;
const rollback = new Error("ROLLBACK_CHARGE_QUERY_MATRIX");

afterAll(async () => client?.end());

describeDatabase("charge query matrix", () => {
  it("applies status precedence, every filter, stable ordering, grouped currencies and RLS", async () => {
    try {
      await database!.transaction(async (transaction) => {
        const ownerId = randomUUID();
        const otherOwnerId = randomUUID();
        const firstClientId = randomUUID();
        const secondClientId = randomUUID();
        const otherClientId = randomUUID();
        const firstServiceId = randomUUID();
        const secondServiceId = randomUUID();
        const ids = {
          overdue: randomUUID(),
          dueToday: randomUUID(),
          upcoming: randomUUID(),
          partial: randomUUID(),
          paid: randomUUID(),
          cancelled: randomUUID(),
          other: randomUUID(),
        };

        await transaction.execute(
          sql`insert into auth.users (id) values (${ownerId}), (${otherOwnerId})`,
        );
        await transaction.insert(clients).values([
          { id: firstClientId, ownerId, firstName: "Matias", lastName: "Parodi", company: "Estudio Norte" },
          { id: secondClientId, ownerId, firstName: "Cliente", lastName: "Global" },
          { id: otherClientId, ownerId: otherOwnerId, firstName: "Aislado" },
        ]);
        await transaction.insert(services).values([
          { id: firstServiceId, ownerId, clientId: firstClientId, name: "Hosting", amountMinor: 10_000, currency: "USD", billingType: "recurring", billingFrequency: "monthly", billingDay: 1, startDate: "2026-01-01" },
          { id: secondServiceId, ownerId, clientId: secondClientId, name: "Diseño", amountMinor: 30_000, currency: "ARS", billingType: "recurring", billingFrequency: "monthly", billingDay: 20, startDate: "2026-01-01" },
        ]);
        await transaction.insert(charges).values([
          { id: ids.overdue, ownerId, clientId: firstClientId, serviceId: firstServiceId, description: "Hosting vencido", amountMinor: 10_000, currency: "USD", dueDate: "2026-08-01" },
          { id: ids.dueToday, ownerId, clientId: firstClientId, serviceId: firstServiceId, description: "Hosting hoy", amountMinor: 20_000, currency: "USD", dueDate: "2026-08-15" },
          { id: ids.upcoming, ownerId, clientId: secondClientId, serviceId: secondServiceId, description: "Diseño próximo", amountMinor: 30_000, currency: "ARS", dueDate: "2026-08-20" },
          { id: ids.partial, ownerId, clientId: firstClientId, serviceId: firstServiceId, description: "Hosting parcial", amountMinor: 10_000, currency: "USD", dueDate: "2026-07-10" },
          { id: ids.paid, ownerId, clientId: firstClientId, serviceId: firstServiceId, description: "Hosting pagado", amountMinor: 10_000, currency: "USD", dueDate: "2026-09-01" },
          { id: ids.cancelled, ownerId, clientId: secondClientId, description: "Diseño cancelado", amountMinor: 5_000, currency: "ARS", dueDate: "2026-08-10", status: "cancelled" },
          { id: ids.other, ownerId: otherOwnerId, clientId: otherClientId, description: "No visible", amountMinor: 99_000, currency: "USD", dueDate: "2026-08-15" },
        ]);
        await transaction.insert(payments).values([
          { ownerId, clientId: firstClientId, chargeId: ids.partial, amountMinor: 4_000, currency: "USD", paymentDate: "2026-07-11", paymentMethod: "cash" },
          { ownerId, clientId: firstClientId, chargeId: ids.paid, amountMinor: 10_000, currency: "USD", paymentDate: "2026-08-01", paymentMethod: "bank_transfer" },
        ]);

        const runAsOwner = createAuthenticatedDrizzleRunner(transaction);
        const list = (filters: Record<string, unknown>) => runAsOwner(ownerId, (ownerDb) => queryCharges(ownerDb, ownerId, filters, "2026-08-15"));
        const identifiers = (rows: Awaited<ReturnType<typeof list>>) => rows.map((row) => row.id);

        const all = await list({ status: "all" });
        expect(identifiers(all)).toEqual([ids.partial, ids.overdue, ids.cancelled, ids.dueToday, ids.upcoming, ids.paid]);
        expect(all.find((row) => row.id === ids.overdue)?.clientName).toBe("Estudio Norte");
        expect(all.find((row) => row.id === ids.upcoming)?.clientName).toBe("Cliente Global");
        expect(Object.fromEntries(all.map((row) => [row.id, row.status]))).toMatchObject({
          [ids.overdue]: "overdue", [ids.dueToday]: "due_today", [ids.upcoming]: "pending",
          [ids.partial]: "partial", [ids.paid]: "paid", [ids.cancelled]: "cancelled",
        });
        await expect(list({ status: "current_month" })).resolves.toHaveLength(4);
        expect(identifiers(await list({ status: "upcoming" }))).toEqual([ids.upcoming]);
        expect(identifiers(await list({ status: "due_today" }))).toEqual([ids.dueToday]);
        expect(identifiers(await list({ status: "overdue" }))).toEqual([ids.overdue]);
        expect(identifiers(await list({ status: "partial" }))).toEqual([ids.partial]);
        expect(identifiers(await list({ status: "paid" }))).toEqual([ids.paid]);
        expect(identifiers(await list({ status: "all", clientId: secondClientId }))).toEqual([ids.cancelled, ids.upcoming]);
        expect(identifiers(await list({ status: "all", currency: "ARS" }))).toEqual([ids.cancelled, ids.upcoming]);
        expect(identifiers(await list({ status: "all", serviceId: secondServiceId }))).toEqual([ids.upcoming]);
        expect(identifiers(await list({ status: "all", from: "2026-08-10", to: "2026-08-15" }))).toEqual([ids.cancelled, ids.dueToday]);
        expect(identifiers(await list({ status: "all", search: "Norte" }))).toEqual([ids.partial, ids.overdue, ids.dueToday, ids.paid]);

        const summary = await runAsOwner(ownerId, (ownerDb) => queryChargeSummary(ownerDb, ownerId, { status: "all" }, "2026-08-15"));
        expect(summary).toEqual([
          { currency: "USD", totalMinor: "50000", paidMinor: "14000", outstandingMinor: "36000" },
          { currency: "ARS", totalMinor: "35000", paidMinor: "0", outstandingMinor: "30000" },
        ]);
        await expect(runAsOwner(ownerId, (ownerDb) => queryCharges(ownerDb, otherOwnerId, { status: "all" }, "2026-08-15"))).resolves.toEqual([]);

        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }, 30_000);
});
