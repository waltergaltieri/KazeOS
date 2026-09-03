// @vitest-environment node

import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAuthenticatedDrizzleRunner } from "@/db/authenticated";
import * as schema from "@/db/schema";
import {
  expenseCategories,
  expenses,
  recurringExpenses,
} from "@/db/schema";
import { loadDatabaseTestEnvironment } from "@/test/database-env";

const databaseUrl = loadDatabaseTestEnvironment();
process.env.APP_ORIGIN = "http://localhost:3000";
const {
  queryExpenseById,
  queryExpenseFormOptions,
  queryExpenses,
  queryExpensesByCategory,
  queryExpensesByScope,
  queryExpenseSummary,
  queryFixedVariableBreakdown,
  queryRecurringExpenseById,
  queryRecurringExpenses,
  queryUpcomingExpenses,
} = await import("./expenses");

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
const rollback = new Error("ROLLBACK_EXPENSE_QUERY_TEST");

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

describeDatabase("expense query matrix", () => {
  it("filters, paginates, joins, summarizes and isolates all expense projections", async () => {
    await withRollback(async (transaction) => {
      const ownerId = randomUUID();
      const otherOwnerId = randomUUID();
      const softwareCategoryId = randomUUID();
      const travelCategoryId = randomUUID();
      const otherCategoryId = randomUUID();
      const recurringExpenseId = randomUUID();
      const futureRecurringExpenseId = randomUUID();
      const expiredRecurringExpenseId = randomUUID();
      const startsInsidePeriodId = randomUUID();
      const endsAtPeriodStartId = randomUUID();
      const otherRecurringExpenseId = randomUUID();
      const ids = {
        overdue: randomUUID(),
        pending: randomUUID(),
        paid: randomUUID(),
        cancelled: randomUUID(),
        recurring: randomUUID(),
        paidOutsideDuePeriod: randomUUID(),
        futurePlanned: randomUUID(),
        other: randomUUID(),
      };

      await transaction.execute(
        sql`insert into auth.users (id) values (${ownerId}), (${otherOwnerId})`,
      );
      await transaction.insert(expenseCategories).values([
        { id: softwareCategoryId, ownerId, name: `Software ${softwareCategoryId}` },
        { id: travelCategoryId, ownerId, name: `Travel ${travelCategoryId}`, active: false },
        { id: otherCategoryId, ownerId: otherOwnerId, name: `Other ${otherCategoryId}` },
      ]);
      await transaction.insert(recurringExpenses).values([
        {
          amountMinor: 300_000,
          automaticGeneration: true,
          billingDay: 12,
          categoryId: softwareCategoryId,
          costType: "fixed",
          currency: "ARS",
          frequency: "quarterly",
          id: recurringExpenseId,
          ownerId,
          scope: "business",
          startDate: "2026-01-01",
          status: "active",
          title: "Cloud plan",
        },
        {
          amountMinor: 999_000,
          billingDay: 1,
          categoryId: otherCategoryId,
          costType: "fixed",
          currency: "USD",
          frequency: "monthly",
          id: otherRecurringExpenseId,
          ownerId: otherOwnerId,
          scope: "business",
          startDate: "2026-01-01",
          status: "active",
          title: "Foreign plan",
        },
        {
          amountMinor: 1_000,
          billingDay: 1,
          categoryId: softwareCategoryId,
          costType: "fixed",
          currency: "USD",
          frequency: "monthly",
          id: futureRecurringExpenseId,
          ownerId,
          scope: "business",
          startDate: "2026-10-01",
          status: "active",
          title: "Future commitment",
        },
        {
          amountMinor: 2_000,
          billingDay: 1,
          categoryId: softwareCategoryId,
          costType: "fixed",
          currency: "USD",
          endDate: "2026-08-31",
          frequency: "monthly",
          id: expiredRecurringExpenseId,
          ownerId,
          scope: "business",
          startDate: "2026-01-01",
          status: "active",
          title: "Expired commitment",
        },
        {
          amountMinor: 3_000,
          billingDay: 30,
          categoryId: softwareCategoryId,
          costType: "fixed",
          currency: "USD",
          frequency: "monthly",
          id: startsInsidePeriodId,
          ownerId,
          scope: "business",
          startDate: "2026-09-30",
          status: "active",
          title: "Starts inside period",
        },
        {
          amountMinor: 4_000,
          billingDay: 1,
          categoryId: softwareCategoryId,
          costType: "fixed",
          currency: "USD",
          endDate: "2026-09-01",
          frequency: "monthly",
          id: endsAtPeriodStartId,
          ownerId,
          scope: "business",
          startDate: "2026-01-01",
          status: "active",
          title: "Ends at period start",
        },
      ]);
      await transaction.insert(expenses).values([
        {
          amountMinor: 10_000,
          categoryId: softwareCategoryId,
          costType: "fixed",
          currency: "USD",
          dueDate: "2026-09-01",
          id: ids.overdue,
          notes: "keep receipt alpha",
          ownerId,
          scope: "business",
          status: "planned",
          title: "Laptop 100% reserve",
        },
        {
          amountMinor: 20_000,
          categoryId: travelCategoryId,
          costType: "variable",
          currency: "USD",
          description: "Cloud migration trip",
          dueDate: "2026-09-20",
          id: ids.pending,
          ownerId,
          scope: "personal",
          status: "pending",
          title: "Conference",
          vendor: "Acme_Travel",
        },
        {
          amountMinor: 30_000,
          categoryId: softwareCategoryId,
          costType: "fixed",
          currency: "USD",
          dueDate: "2026-09-10",
          id: ids.paid,
          ownerId,
          notes: "Path C:\\Billing",
          paidDate: "2026-09-15",
          paymentMethod: "credit_card",
          scope: "business",
          status: "paid",
          title: "Paid software",
        },
        {
          amountMinor: 40_000,
          categoryId: softwareCategoryId,
          costType: "variable",
          currency: "USD",
          dueDate: "2026-09-05",
          id: ids.cancelled,
          ownerId,
          scope: "business",
          status: "cancelled",
          title: "Cancelled campaign",
        },
        {
          amountMinor: 50_000,
          categoryId: softwareCategoryId,
          costType: "fixed",
          currency: "ARS",
          dueDate: "2026-09-12",
          generatedAutomatically: true,
          id: ids.recurring,
          ownerId,
          periodKey: "quarterly:2026-Q3",
          recurringExpenseId,
          scope: "business",
          status: "pending",
          title: "Cloud plan",
        },
        {
          amountMinor: 70_000,
          categoryId: travelCategoryId,
          costType: "variable",
          currency: "ARS",
          dueDate: "2026-08-30",
          id: ids.paidOutsideDuePeriod,
          ownerId,
          paidDate: "2026-09-18",
          paymentMethod: "cash",
          scope: "partner",
          status: "paid",
          title: "August dinner",
        },
        {
          amountMinor: 90_000,
          categoryId: softwareCategoryId,
          costType: "fixed",
          currency: "ARS",
          dueDate: "2026-10-05",
          id: ids.futurePlanned,
          ownerId,
          scope: "family",
          status: "planned",
          title: "October reserve",
        },
        {
          amountMinor: 999_999,
          categoryId: otherCategoryId,
          costType: "fixed",
          currency: "USD",
          dueDate: "2026-09-01",
          id: ids.other,
          ownerId: otherOwnerId,
          scope: "business",
          status: "pending",
          title: "Foreign expense",
        },
      ]);

      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);
      const list = (filters: Record<string, unknown>) => runAsOwner(
        ownerId,
        (ownerDb) => queryExpenses(ownerDb, ownerId, filters, "2026-09-10"),
      );
      const identifiers = async (filters: Record<string, unknown>) =>
        (await list(filters)).items.map(({ id }) => id);

      const all = await list({ page: 1, pageSize: 20, period: "all" });
      expect(all.pagination).toEqual({ page: 1, pageSize: 20, total: 7, totalPages: 1 });
      expect(all.items.find(({ id }) => id === ids.recurring)).toMatchObject({
        category: expect.objectContaining({ id: softwareCategoryId }),
        recurringExpense: expect.objectContaining({ id: recurringExpenseId, title: "Cloud plan" }),
        status: "pending",
      });
      expect(all.items.find(({ id }) => id === ids.overdue)?.status).toBe("overdue");
      expect(await identifiers({ period: "all", search: "Laptop" })).toContain(ids.overdue);
      expect(await identifiers({ period: "all", search: "Acme" })).toEqual([ids.pending]);
      expect(await identifiers({ period: "all", search: "migration" })).toEqual([ids.pending]);
      expect(await identifiers({ period: "all", search: "receipt alpha" })).toEqual([ids.overdue]);
      expect(await identifiers({ period: "all", search: "%" })).toEqual([ids.overdue]);
      expect(await identifiers({ period: "all", search: "_" })).toEqual([ids.pending]);
      expect(await identifiers({ period: "all", search: "\\" })).toEqual([ids.paid]);
      expect(await identifiers({ period: "all", status: "overdue" })).toEqual([ids.overdue]);
      expect(await identifiers({ period: "all", status: "planned" })).toEqual([ids.futurePlanned]);
      expect(await identifiers({ period: "current_month" })).toHaveLength(5);
      expect(await identifiers({ month: "2026-10", period: "current_month" }))
        .toEqual([ids.futurePlanned]);
      expect(await identifiers({ period: "next_month" })).toEqual([ids.futurePlanned]);
      expect(await identifiers({
        from: "2026-09-10",
        period: "custom",
        to: "2026-09-12",
      })).toEqual([ids.paid, ids.recurring]);
      expect(await identifiers({ categoryId: travelCategoryId, period: "all" }))
        .toEqual([ids.paidOutsideDuePeriod, ids.pending]);
      expect(await identifiers({ period: "all", scope: "partner" }))
        .toEqual([ids.paidOutsideDuePeriod]);
      expect(await identifiers({ costType: "variable", period: "all" }))
        .toEqual([ids.paidOutsideDuePeriod, ids.cancelled, ids.pending]);
      expect(await identifiers({ period: "all", recurrence: "recurring" }))
        .toEqual([ids.recurring]);
      expect(await identifiers({ period: "all", recurrence: "one_off" }))
        .toEqual([
          ids.overdue,
          ids.paidOutsideDuePeriod,
          ids.cancelled,
          ids.paid,
          ids.pending,
          ids.futurePlanned,
        ]);
      expect(await identifiers({ currency: "USD", period: "all" }))
        .toEqual([ids.overdue, ids.cancelled, ids.paid, ids.pending]);

      const secondPage = await list({ page: 2, pageSize: 2, period: "all" });
      expect(secondPage.pagination).toEqual({ page: 2, pageSize: 2, total: 7, totalPages: 4 });
      expect(secondPage.items).toHaveLength(2);
      observedQueries.length = 0;
      const emptyPage = await queryExpenses(
        transaction,
        ownerId,
        { page: 99, pageSize: 2, period: "all" },
        "2026-09-10",
      );
      expect(emptyPage.items).toEqual([]);
      expect(emptyPage.pagination).toEqual({ page: 99, pageSize: 2, total: 7, totalPages: 4 });
      expect(observedQueries).toHaveLength(1);

      observedQueries.length = 0;
      const joinedPage = await queryExpenses(
        transaction,
        ownerId,
        { page: 1, pageSize: 20, period: "all" },
        "2026-09-10",
      );
      expect(joinedPage.items).toHaveLength(7);
      expect(observedQueries).toHaveLength(1);
      expect(observedQueries[0]).toMatch(/join "expense_categories"/i);
      expect(observedQueries[0]).toMatch(/join "recurring_expenses"/i);

      const period = { start: "2026-09-01", end: "2026-10-01" };
      const summary = await runAsOwner(ownerId, (ownerDb) =>
        queryExpenseSummary(ownerDb, ownerId, period, "2026-09-10"),
      );
      expect(summary).toEqual({
        USD: {
          actual: "30000",
          fixed: "40000",
          monthlyFixedCommitments: "7000",
          overdue: "10000",
          pending: "20000",
          projected: "60000",
          variable: "20000",
        },
        ARS: {
          actual: "70000",
          fixed: "50000",
          monthlyFixedCommitments: "100000",
          overdue: "0",
          pending: "50000",
          projected: "50000",
          variable: "0",
        },
      });

      const byCategory = await runAsOwner(ownerId, (ownerDb) =>
        queryExpensesByCategory(ownerDb, ownerId, period),
      );
      expect(byCategory).toEqual([
        {
          categoryId: softwareCategoryId,
          icon: null,
          label: `Software ${softwareCategoryId}`,
          amounts: { USD: "40000", ARS: "50000" },
        },
        {
          categoryId: travelCategoryId,
          icon: null,
          label: `Travel ${travelCategoryId}`,
          amounts: { USD: "20000", ARS: "0" },
        },
      ]);
      expect(await runAsOwner(ownerId, (ownerDb) =>
        queryExpensesByScope(ownerDb, ownerId, period),
      )).toEqual([
        { key: "business", amounts: { USD: "40000", ARS: "50000" } },
        { key: "personal", amounts: { USD: "20000", ARS: "0" } },
      ]);
      expect(await runAsOwner(ownerId, (ownerDb) =>
        queryFixedVariableBreakdown(ownerDb, ownerId, period),
      )).toEqual([
        { key: "fixed", amounts: { USD: "40000", ARS: "50000" } },
        { key: "variable", amounts: { USD: "20000", ARS: "0" } },
      ]);

      const upcoming = await runAsOwner(ownerId, (ownerDb) =>
        queryUpcomingExpenses(ownerDb, ownerId, "2026-09-10", 3),
      );
      expect(upcoming.map(({ id }) => id)).toEqual([
        ids.overdue,
        ids.recurring,
        ids.pending,
      ]);

      const expense = await runAsOwner(ownerId, (ownerDb) =>
        queryExpenseById(ownerDb, ownerId, ids.recurring, "2026-09-10"),
      );
      expect(expense).toMatchObject({
        id: ids.recurring,
        category: { id: softwareCategoryId },
        recurringExpense: { id: recurringExpenseId, title: "Cloud plan" },
      });
      await expect(runAsOwner(ownerId, (ownerDb) =>
        queryExpenseById(ownerDb, otherOwnerId, ids.other, "2026-09-10"),
      )).resolves.toBeNull();

      const options = await runAsOwner(ownerId, (ownerDb) =>
        queryExpenseFormOptions(ownerDb, ownerId),
      );
      expect(options.categories).toEqual([
        expect.objectContaining({ id: softwareCategoryId, active: true }),
      ]);
      expect(options.recurringExpenses).toEqual([
        expect.objectContaining({ id: recurringExpenseId, title: "Cloud plan" }),
        expect.objectContaining({ id: endsAtPeriodStartId, title: "Ends at period start" }),
        expect.objectContaining({ id: expiredRecurringExpenseId, title: "Expired commitment" }),
        expect.objectContaining({ id: futureRecurringExpenseId, title: "Future commitment" }),
        expect.objectContaining({ id: startsInsidePeriodId, title: "Starts inside period" }),
      ]);
      expect(await runAsOwner(ownerId, (ownerDb) =>
        queryRecurringExpenses(ownerDb, ownerId),
      )).toHaveLength(5);
      expect(await runAsOwner(ownerId, (ownerDb) =>
        queryRecurringExpenseById(ownerDb, ownerId, recurringExpenseId),
      )).toMatchObject({ id: recurringExpenseId, category: { id: softwareCategoryId } });
      await expect(runAsOwner(ownerId, (ownerDb) =>
        queryRecurringExpenseById(ownerDb, otherOwnerId, otherRecurringExpenseId),
      )).resolves.toBeNull();
    });
  }, 60_000);

  it("puts overdue expenses on page one before applying the page limit", async () => {
    await withRollback(async (transaction) => {
      const ownerId = randomUUID();
      const categoryId = randomUUID();
      const overdueIds = [randomUUID(), randomUUID()].sort();

      await transaction.execute(sql`insert into auth.users (id) values (${ownerId})`);
      await transaction.insert(expenseCategories).values({ id: categoryId, ownerId, name: `Priority ${categoryId}` });
      await transaction.insert(expenses).values([
        ...Array.from({ length: 26 }, (_, index) => ({
          amountMinor: 1_000 + index,
          categoryId,
          costType: "fixed" as const,
          currency: "USD" as const,
          dueDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
          id: randomUUID(),
          ownerId,
          paidDate: "2026-08-31",
          paymentMethod: "cash" as const,
          scope: "business" as const,
          status: "paid" as const,
          title: `Historical ${index}`,
        })),
        ...overdueIds.map((id) => ({
          amountMinor: 5_000,
          categoryId,
          costType: "fixed" as const,
          currency: "USD" as const,
          dueDate: "2026-09-09",
          id,
          ownerId,
          scope: "business" as const,
          status: "pending" as const,
          title: `Overdue ${id}`,
        })),
      ]);

      const firstPage = await queryExpenses(transaction, ownerId, { page: 1, pageSize: 25, period: "all" }, "2026-09-10");

      expect(firstPage.pagination.total).toBe(28);
      expect(firstPage.items.slice(0, 2).map(({ id }) => id)).toEqual(overdueIds);
      expect(firstPage.items.slice(0, 2).every(({ status }) => status === "overdue")).toBe(true);
    });
  }, 60_000);
});
