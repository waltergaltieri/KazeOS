// @vitest-environment node

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAuthenticatedDrizzleRunner } from "@/db/authenticated";
import * as schema from "@/db/schema";
import {
  charges,
  clients,
  expenseCategories,
  expenses,
  payments,
} from "@/db/schema";

config({ path: resolve(process.cwd(), "../..", ".env.local"), quiet: true });
process.env.APP_ORIGIN = "http://localhost:3000";
const { queryMonthlyCashFlow } = await import("./cash-flow");

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const observedQueries: string[] = [];
const databaseClient = databaseUrl
  ? postgres(databaseUrl, {
      prepare: false,
      max: 1,
      debug: (_connection, query) => observedQueries.push(query),
    })
  : undefined;
const database = databaseClient
  ? drizzle({ client: databaseClient, schema })
  : undefined;
const rollback = new Error("ROLLBACK_CASH_FLOW_QUERY_TEST");

type Database = NonNullable<typeof database>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

afterAll(async () => databaseClient?.end());

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

describeDatabase("monthly cash flow query", () => {
  it("uses due, paid and payment dates in one currency-separated SQL round trip", async () => {
    await withRollback(async (transaction) => {
      const ownerId = randomUUID();
      const otherOwnerId = randomUUID();
      const clientId = randomUUID();
      const otherClientId = randomUUID();
      const categoryId = randomUUID();
      const otherCategoryId = randomUUID();
      const chargeId = randomUUID();
      const dueThisMonthPaidNextMonthChargeId = randomUUID();
      const dueLastMonthPaidThisMonthChargeId = randomUUID();
      const otherChargeId = randomUUID();

      await transaction.execute(
        sql`insert into auth.users (id) values (${ownerId}), (${otherOwnerId})`,
      );
      await transaction.insert(clients).values([
        { id: clientId, ownerId, firstName: "Cash", lastName: "Flow" },
        { id: otherClientId, ownerId: otherOwnerId, firstName: "Other" },
      ]);
      await transaction.insert(expenseCategories).values([
        { id: categoryId, ownerId, name: `Cash flow ${categoryId}` },
        { id: otherCategoryId, ownerId: otherOwnerId, name: `Other ${otherCategoryId}` },
      ]);
      await transaction.insert(charges).values([
        {
          amountMinor: 200_000,
          clientId,
          currency: "USD",
          description: "September income",
          dueDate: "2026-09-05",
          id: chargeId,
          ownerId,
        },
        {
          amountMinor: 40_000,
          clientId,
          currency: "ARS",
          description: "ARS income",
          dueDate: "2026-09-07",
          ownerId,
        },
        {
          amountMinor: 60_000,
          clientId,
          currency: "USD",
          description: "Due September paid October",
          dueDate: "2026-09-29",
          id: dueThisMonthPaidNextMonthChargeId,
          ownerId,
        },
        {
          amountMinor: 80_000,
          clientId,
          currency: "USD",
          description: "Due August paid September",
          dueDate: "2026-08-29",
          id: dueLastMonthPaidThisMonthChargeId,
          ownerId,
        },
        {
          amountMinor: 999_999,
          clientId,
          currency: "USD",
          description: "Cancelled income",
          dueDate: "2026-09-08",
          ownerId,
          status: "cancelled",
        },
        {
          amountMinor: 999_999,
          clientId: otherClientId,
          currency: "USD",
          description: "Foreign income",
          dueDate: "2026-09-05",
          id: otherChargeId,
          ownerId: otherOwnerId,
        },
      ]);
      await transaction.insert(payments).values([
        {
          amountMinor: 140_000,
          chargeId,
          clientId,
          currency: "USD",
          ownerId,
          paymentDate: "2026-09-10",
          paymentMethod: "bank_transfer",
        },
        {
          amountMinor: 10_000,
          clientId,
          currency: "ARS",
          ownerId,
          paymentDate: "2026-09-11",
          paymentMethod: "cash",
        },
        {
          amountMinor: 60_000,
          chargeId: dueThisMonthPaidNextMonthChargeId,
          clientId,
          currency: "USD",
          ownerId,
          paymentDate: "2026-10-01",
          paymentMethod: "bank_transfer",
        },
        {
          amountMinor: 80_000,
          chargeId: dueLastMonthPaidThisMonthChargeId,
          clientId,
          currency: "USD",
          ownerId,
          paymentDate: "2026-09-12",
          paymentMethod: "bank_transfer",
        },
        {
          amountMinor: 999_999,
          chargeId: otherChargeId,
          clientId: otherClientId,
          currency: "USD",
          ownerId: otherOwnerId,
          paymentDate: "2026-09-10",
          paymentMethod: "cash",
        },
      ]);
      await transaction.insert(expenses).values([
        {
          amountMinor: 50_000,
          categoryId,
          costType: "fixed",
          currency: "USD",
          dueDate: "2026-09-02",
          ownerId,
          paidDate: "2026-09-20",
          paymentMethod: "cash",
          scope: "business",
          status: "paid",
          title: "Paid expense",
        },
        {
          amountMinor: 30_000,
          categoryId,
          costType: "variable",
          currency: "USD",
          dueDate: "2026-09-25",
          ownerId,
          scope: "business",
          title: "Pending expense",
        },
        {
          amountMinor: 20_000,
          categoryId,
          costType: "variable",
          currency: "ARS",
          dueDate: "2026-09-26",
          ownerId,
          scope: "personal",
          title: "ARS expense",
        },
        {
          amountMinor: 7_000,
          categoryId,
          costType: "fixed",
          currency: "USD",
          dueDate: "2026-09-28",
          ownerId,
          paidDate: "2026-10-01",
          paymentMethod: "cash",
          scope: "business",
          status: "paid",
          title: "Due September paid October",
        },
        {
          amountMinor: 11_000,
          categoryId,
          costType: "variable",
          currency: "USD",
          dueDate: "2026-08-28",
          ownerId,
          paidDate: "2026-09-22",
          paymentMethod: "cash",
          scope: "business",
          status: "paid",
          title: "Due August paid September",
        },
        {
          amountMinor: 999_999,
          categoryId,
          costType: "fixed",
          currency: "USD",
          dueDate: "2026-09-12",
          ownerId,
          scope: "business",
          status: "cancelled",
          title: "Cancelled expense",
        },
        {
          amountMinor: 999_999,
          categoryId: otherCategoryId,
          costType: "fixed",
          currency: "USD",
          dueDate: "2026-09-12",
          ownerId: otherOwnerId,
          scope: "business",
          title: "Foreign expense",
        },
      ]);

      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);
      observedQueries.length = 0;
      await expect(queryMonthlyCashFlow(
        transaction,
        ownerId,
        "2026-09-01",
        "2026-10-01",
      )).resolves.toEqual({
        USD: {
          projectedIncome: "260000",
          actualIncome: "220000",
          projectedExpenses: "87000",
          actualExpenses: "61000",
          projectedNet: "173000",
          actualNet: "159000",
        },
        ARS: {
          projectedIncome: "40000",
          actualIncome: "10000",
          projectedExpenses: "20000",
          actualExpenses: "0",
          projectedNet: "20000",
          actualNet: "10000",
        },
      });
      expect(observedQueries).toHaveLength(1);
      expect(observedQueries[0]).toMatch(/^\s*with projected_income/i);
      await expect(runAsOwner(ownerId, (ownerDb) =>
        queryMonthlyCashFlow(ownerDb, otherOwnerId, "2026-09-01", "2026-10-01"),
      )).resolves.toEqual({
        USD: {
          projectedIncome: "0",
          actualIncome: "0",
          projectedExpenses: "0",
          actualExpenses: "0",
          projectedNet: "0",
          actualNet: "0",
        },
        ARS: {
          projectedIncome: "0",
          actualIncome: "0",
          projectedExpenses: "0",
          actualExpenses: "0",
          projectedNet: "0",
          actualNet: "0",
        },
      });
    });
  }, 30_000);
});
