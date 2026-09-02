// @vitest-environment node

import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const runtime = vi.hoisted(() => ({
  userId: "",
  run: undefined as undefined | ((ownerId: string, operation: (db: never) => unknown) => unknown),
}));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ id: runtime.userId }),
}));
vi.mock("@/db", () => ({
  withAuthenticatedDb: (ownerId: string, operation: (db: never) => unknown) => runtime.run!(ownerId, operation),
}));

import { createAuthenticatedDrizzleRunner } from "@/db/authenticated";
import * as schema from "@/db/schema";
import { charges, clients, payments, services, tasks } from "@/db/schema";
import {
  getDashboardMetrics,
  getMonthlyRevenue,
  getPendingTasks,
  getUpcomingCharges,
  getUpcomingMovements,
} from "./dashboard";

config({ path: ".env.local", quiet: true });
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? postgres(databaseUrl, { prepare: false, max: 1 }) : undefined;
const database = client ? drizzle({ client, schema }) : undefined;
const rollback = new Error("ROLLBACK_DASHBOARD_QUERY_TEST");

afterAll(async () => client?.end());

describeDatabase("real-data dashboard queries", () => {
  it("returns exact owner-scoped metrics, operational ordering, movements and six-month revenue", async () => {
    try {
      await database!.transaction(async (transaction) => {
        const ownerId = randomUUID();
        const otherOwnerId = randomUUID();
        const activeClientId = randomUUID();
        const secondClientId = randomUUID();
        const pausedClientId = randomUUID();
        const otherClientId = randomUUID();
        const monthlyServiceId = randomUUID();
        const quarterlyServiceId = randomUUID();
        const yearlyServiceId = randomUUID();
        const overdueChargeId = randomUUID();
        const paidChargeId = randomUUID();
        const dueTodayChargeId = randomUUID();
        const upcomingChargeId = randomUUID();
        const outsideWindowChargeId = randomUUID();
        const nextMonthChargeId = randomUUID();

        await transaction.execute(
          sql`insert into auth.users (id) values (${ownerId}), (${otherOwnerId})`,
        );
        await transaction.insert(clients).values([
          { id: activeClientId, ownerId, firstName: "Estudio", lastName: "Norte" },
          { id: secondClientId, ownerId, firstName: "Cliente", lastName: "Global" },
          { id: pausedClientId, ownerId, firstName: "En pausa", status: "paused" },
          { id: otherClientId, ownerId: otherOwnerId, firstName: "Ajeno" },
        ]);
        await transaction.insert(services).values([
          { id: monthlyServiceId, ownerId, clientId: activeClientId, name: "Mensual", billingType: "recurring", billingFrequency: "monthly", billingDay: 1, amountMinor: 12_000, currency: "USD", startDate: "2026-01-01" },
          { id: quarterlyServiceId, ownerId, clientId: secondClientId, name: "Trimestral", billingType: "recurring", billingFrequency: "quarterly", billingDay: 1, amountMinor: 30_000, currency: "USD", startDate: "2026-01-01" },
          { id: yearlyServiceId, ownerId, clientId: secondClientId, name: "Anual", billingType: "recurring", billingFrequency: "yearly", billingDay: 1, amountMinor: 120_000, currency: "ARS", startDate: "2026-01-01" },
          { ownerId, clientId: pausedClientId, name: "Pausado", billingType: "recurring", billingFrequency: "monthly", billingDay: 1, amountMinor: 999_999, currency: "USD", startDate: "2026-01-01", status: "paused" },
        ]);
        await transaction.insert(charges).values([
          { id: overdueChargeId, ownerId, clientId: activeClientId, description: "Hosting vencido", amountMinor: 10_000, currency: "USD", dueDate: "2026-08-10" },
          { id: paidChargeId, ownerId, clientId: activeClientId, description: "Implementación cobrada", amountMinor: 6_000, currency: "USD", dueDate: "2026-08-12" },
          { id: dueTodayChargeId, ownerId, clientId: secondClientId, description: "Diseño de hoy", amountMinor: 20_000, currency: "ARS", dueDate: "2026-08-15" },
          { id: upcomingChargeId, ownerId, clientId: activeClientId, description: "Soporte próximo", amountMinor: 30_000, currency: "USD", dueDate: "2026-08-20" },
          { id: outsideWindowChargeId, ownerId, clientId: activeClientId, description: "Fuera de ventana", amountMinor: 40_000, currency: "USD", dueDate: "2026-08-30" },
          { id: nextMonthChargeId, ownerId, clientId: activeClientId, description: "Mes siguiente", amountMinor: 50_000, currency: "USD", dueDate: "2026-09-01" },
          { ownerId, clientId: activeClientId, description: "Cancelado", amountMinor: 800_000, currency: "USD", dueDate: "2026-08-01", status: "cancelled" },
          { ownerId: otherOwnerId, clientId: otherClientId, description: "Ajeno vencido", amountMinor: 900_000, currency: "USD", dueDate: "2026-08-01" },
        ]);
        await transaction.insert(payments).values([
          { ownerId, clientId: activeClientId, chargeId: overdueChargeId, amountMinor: 2_000, currency: "USD", paymentDate: "2026-07-15", paymentMethod: "cash" },
          { ownerId, clientId: activeClientId, chargeId: paidChargeId, amountMinor: 6_000, currency: "USD", paymentDate: "2026-08-02", paymentMethod: "bank_transfer" },
          { ownerId, clientId: activeClientId, amountMinor: 1_000, currency: "USD", paymentDate: "2026-03-03", paymentMethod: "cash" },
          { ownerId, clientId: activeClientId, amountMinor: 2_000, currency: "ARS", paymentDate: "2026-05-03", paymentMethod: "cash" },
          { ownerId, clientId: activeClientId, amountMinor: 5_000, currency: "ARS", paymentDate: "2026-08-04", paymentMethod: "cash" },
          { ownerId, clientId: activeClientId, amountMinor: Number.MAX_SAFE_INTEGER, currency: "ARS", paymentDate: "2026-08-05", paymentMethod: "cash" },
          { ownerId, clientId: secondClientId, amountMinor: Number.MAX_SAFE_INTEGER, currency: "ARS", paymentDate: "2026-08-06", paymentMethod: "cash" },
          { ownerId: otherOwnerId, clientId: otherClientId, amountMinor: 700_000, currency: "USD", paymentDate: "2026-08-03", paymentMethod: "cash" },
        ]);
        await transaction.insert(tasks).values([
          { id: randomUUID(), ownerId, clientId: activeClientId, title: "Renovar dominio", dueDate: "2026-08-14", priority: "low" },
          { id: randomUUID(), ownerId, clientId: secondClientId, title: "Enviar informe", dueDate: "2026-08-15", priority: "medium" },
          { id: randomUUID(), ownerId, title: "Llamar al cliente", dueDate: "2026-08-16", priority: "high" },
          { id: randomUUID(), ownerId, title: "Sin fecha", priority: "high" },
          { id: randomUUID(), ownerId, title: "Completada", dueDate: "2026-08-13", status: "completed", completedAt: new Date("2026-08-13T12:00:00Z") },
          { id: randomUUID(), ownerId: otherOwnerId, clientId: otherClientId, title: "Tarea ajena", dueDate: "2026-08-01" },
        ]);

        runtime.userId = ownerId;
        runtime.run = createAuthenticatedDrizzleRunner(transaction) as typeof runtime.run;

        await expect(getDashboardMetrics("2026-08-15")).resolves.toEqual({
          collectedThisMonth: { USD: "6000", ARS: "18014398509486982" },
          pending: { USD: "78000", ARS: "20000" },
          overdue: { USD: "8000", ARS: "0" },
          mrr: { USD: "22000", ARS: "10000" },
          activeClients: 2,
          chargesNextSevenDays: 2,
        });

        const upcoming = await getUpcomingCharges("2026-08-15");
        expect(upcoming.map((item) => item.description)).toEqual([
          "Hosting vencido",
          "Diseño de hoy",
          "Soporte próximo",
          "Fuera de ventana",
          "Mes siguiente",
        ]);
        expect(upcoming[0]).toMatchObject({ status: "partial", isOverdue: true, outstandingMinor: "8000" });

        const pending = await getPendingTasks("2026-08-15");
        expect(pending.map((item) => item.title)).toEqual([
          "Renovar dominio",
          "Enviar informe",
          "Llamar al cliente",
          "Sin fecha",
        ]);

        const movements = await getUpcomingMovements("2026-08-15");
        expect(movements.slice(0, 4).map((item) => `${item.kind}:${item.label}`)).toEqual([
          "charge:Hosting vencido",
          "task:Renovar dominio",
          "charge:Diseño de hoy",
          "task:Enviar informe",
        ]);

        await expect(getMonthlyRevenue("2026-08-15")).resolves.toEqual([
          { month: "2026-03", USD: "1000", ARS: "0" },
          { month: "2026-04", USD: "0", ARS: "0" },
          { month: "2026-05", USD: "0", ARS: "2000" },
          { month: "2026-06", USD: "0", ARS: "0" },
          { month: "2026-07", USD: "2000", ARS: "0" },
          { month: "2026-08", USD: "6000", ARS: "18014398509486982" },
        ]);

        runtime.userId = otherOwnerId;
        await expect(getDashboardMetrics("2026-08-15")).resolves.toMatchObject({
          collectedThisMonth: { USD: "700000", ARS: "0" },
          activeClients: 1,
        });
        await expect(getPendingTasks("2026-08-15")).resolves.toEqual([
          expect.objectContaining({ title: "Tarea ajena" }),
        ]);

        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }, 45_000);
});
