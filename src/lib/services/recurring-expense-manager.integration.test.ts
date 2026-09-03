// @vitest-environment node

import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { asc, eq, sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as schema from "@/db/schema";
import {
  expenseCategories,
  expenses,
  recurringExpenses,
} from "@/db/schema";

import {
  cancelRecurringExpense,
  createRecurringExpenseWithOccurrences,
  pauseRecurringExpense,
  updateRecurringExpenseWithOccurrences,
} from "./recurring-expense-manager";
import {
  ExpenseCategoryInactiveError,
  ExpenseCategoryNotFoundError,
} from "./expense-category-manager";

config({ path: ".env.local", quiet: true });

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const databaseClient = databaseUrl
  ? postgres(databaseUrl, { prepare: false, max: 1 })
  : undefined;
const database = databaseClient
  ? drizzle({ client: databaseClient, schema })
  : undefined;
const rollback = new Error("ROLLBACK_RECURRING_EXPENSE_MANAGER_TEST");
type Database = NonNullable<typeof database>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const initialValues = (categoryId: string) => ({
  amountMinor: 20_000,
  automaticGeneration: true,
  billingDay: 10,
  categoryId,
  costType: "fixed" as const,
  currency: "USD" as const,
  description: "Original description",
  endDate: null,
  frequency: "monthly" as const,
  notes: "Original notes",
  paymentMethod: "bank_transfer" as const,
  scope: "business" as const,
  startDate: "2026-09-01",
  title: "Original title",
  vendor: "Original vendor",
});

async function withFixture(
  operation: (fixture: {
    categoryId: string;
    nextCategoryId: string;
    ownerId: string;
    transaction: Transaction;
  }) => Promise<void>,
) {
  try {
    await database!.transaction(async (transaction) => {
      const ownerId = randomUUID();
      const categoryId = randomUUID();
      const nextCategoryId = randomUUID();
      await transaction.execute(
        drizzleSql`insert into auth.users (id) values (${ownerId})`,
      );
      await transaction.insert(expenseCategories).values([
        { id: categoryId, name: `Old ${categoryId}`, ownerId },
        { id: nextCategoryId, name: `New ${nextCategoryId}`, ownerId },
      ]);

      await operation({ categoryId, nextCategoryId, ownerId, transaction });
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}

afterAll(async () => {
  await databaseClient?.end();
});

describeDatabase("recurring expense manager", () => {
  it("creates a template and its initial three-month projection", async () => {
    await withFixture(async ({ categoryId, ownerId, transaction }) => {
      const result = await createRecurringExpenseWithOccurrences(transaction, {
        asOf: "2026-09-01",
        ownerId,
        values: initialValues(categoryId),
      });

      expect(result.generated).toEqual({
        candidates: 3,
        eligibleTemplates: 1,
        inserted: 3,
        skipped: 0,
      });
      const [template] = await transaction
        .select({ id: recurringExpenses.id, status: recurringExpenses.status })
        .from(recurringExpenses)
        .where(eq(recurringExpenses.id, result.id));
      expect(template).toEqual({ id: result.id, status: "active" });
    });
  }, 30_000);

  it("rejects inactive and foreign categories for new templates", async () => {
    await withFixture(async ({ categoryId, ownerId, transaction }) => {
      await transaction
        .update(expenseCategories)
        .set({ active: false })
        .where(eq(expenseCategories.id, categoryId));

      await expect(
        createRecurringExpenseWithOccurrences(transaction, {
          asOf: "2026-09-01",
          ownerId,
          values: initialValues(categoryId),
        }),
      ).rejects.toBeInstanceOf(ExpenseCategoryInactiveError);
      await expect(
        createRecurringExpenseWithOccurrences(transaction, {
          asOf: "2026-09-01",
          ownerId,
          values: initialValues(randomUUID()),
        }),
      ).rejects.toBeInstanceOf(ExpenseCategoryNotFoundError);
    });
  }, 30_000);

  it("rejects changing a template to an inactive category", async () => {
    await withFixture(async ({ categoryId, nextCategoryId, ownerId, transaction }) => {
      const created = await createRecurringExpenseWithOccurrences(transaction, {
        asOf: "2026-09-01",
        ownerId,
        values: initialValues(categoryId),
      });
      await transaction
        .update(expenseCategories)
        .set({ active: false })
        .where(eq(expenseCategories.id, nextCategoryId));

      await expect(
        updateRecurringExpenseWithOccurrences(transaction, {
          asOf: "2026-09-01",
          ownerId,
          recurringExpenseId: created.id,
          values: initialValues(nextCategoryId),
        }),
      ).rejects.toBeInstanceOf(ExpenseCategoryInactiveError);
    });
  }, 30_000);

  it("updates only future automatic unpaid rows, cancels obsolete projections and preserves paid/past history", async () => {
    await withFixture(async ({
      categoryId,
      nextCategoryId,
      ownerId,
      transaction,
    }) => {
      const created = await createRecurringExpenseWithOccurrences(transaction, {
        asOf: "2026-09-01",
        ownerId,
        values: initialValues(categoryId),
      });
      const before = await transaction
        .select({ dueDate: expenses.dueDate, id: expenses.id })
        .from(expenses)
        .where(eq(expenses.recurringExpenseId, created.id))
        .orderBy(asc(expenses.dueDate));
      const [past, paid, future] = before;
      expect(before).toHaveLength(3);

      await transaction
        .update(expenses)
        .set({ paidDate: "2026-10-05", status: "paid" })
        .where(eq(expenses.id, paid!.id));

      const result = await updateRecurringExpenseWithOccurrences(transaction, {
        asOf: "2026-10-15",
        ownerId,
        recurringExpenseId: created.id,
        values: {
          ...initialValues(nextCategoryId),
          amountMinor: 35_000,
          billingDay: 20,
          costType: "variable",
          currency: "ARS",
          description: "Updated description",
          frequency: "quarterly",
          notes: "Updated notes",
          paymentMethod: "credit_card",
          scope: "personal",
          title: "Updated title",
          vendor: "Updated vendor",
        },
      });

      expect(result.generated).toEqual({
        candidates: 1,
        eligibleTemplates: 1,
        inserted: 1,
        skipped: 0,
      });
      const rows = await transaction
        .select({
          amountMinor: expenses.amountMinor,
          categoryId: expenses.categoryId,
          costType: expenses.costType,
          currency: expenses.currency,
          description: expenses.description,
          dueDate: expenses.dueDate,
          id: expenses.id,
          notes: expenses.notes,
          paymentMethod: expenses.paymentMethod,
          scope: expenses.scope,
          status: expenses.status,
          title: expenses.title,
          vendor: expenses.vendor,
        })
        .from(expenses)
        .where(eq(expenses.recurringExpenseId, created.id))
        .orderBy(asc(expenses.dueDate), asc(expenses.id));

      expect(rows.find(({ id }) => id === past!.id)).toMatchObject({
        amountMinor: 20_000,
        categoryId,
        dueDate: "2026-09-10",
        status: "pending",
        title: "Original title",
      });
      expect(rows.find(({ id }) => id === paid!.id)).toMatchObject({
        amountMinor: 20_000,
        categoryId,
        dueDate: "2026-10-10",
        status: "paid",
        title: "Original title",
      });
      expect(rows.find(({ id }) => id === future!.id)).toMatchObject({
        amountMinor: 20_000,
        categoryId,
        dueDate: "2026-11-10",
        status: "cancelled",
        title: "Original title",
      });
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            amountMinor: 35_000,
            categoryId: nextCategoryId,
            costType: "variable",
            currency: "ARS",
            description: "Updated description",
            dueDate: "2026-12-20",
            notes: "Updated notes",
            paymentMethod: "credit_card",
            scope: "personal",
            status: "pending",
            title: "Updated title",
            vendor: "Updated vendor",
          }),
        ]),
      );
    });
  }, 30_000);

  it("reconciles a matching future period in place", async () => {
    await withFixture(async ({ categoryId, nextCategoryId, ownerId, transaction }) => {
      const created = await createRecurringExpenseWithOccurrences(transaction, {
        asOf: "2026-09-01",
        ownerId,
        values: initialValues(categoryId),
      });
      const before = await transaction
        .select({ dueDate: expenses.dueDate, id: expenses.id })
        .from(expenses)
        .where(eq(expenses.recurringExpenseId, created.id))
        .orderBy(asc(expenses.dueDate));

      await updateRecurringExpenseWithOccurrences(transaction, {
        asOf: "2026-10-01",
        ownerId,
        recurringExpenseId: created.id,
        values: {
          ...initialValues(nextCategoryId),
          amountMinor: 30_000,
          billingDay: 20,
          title: "Updated in place",
        },
      });

      const rows = await transaction
        .select({
          amountMinor: expenses.amountMinor,
          categoryId: expenses.categoryId,
          dueDate: expenses.dueDate,
          id: expenses.id,
          status: expenses.status,
          title: expenses.title,
        })
        .from(expenses)
        .where(eq(expenses.recurringExpenseId, created.id))
        .orderBy(asc(expenses.dueDate));

      expect(rows.find(({ id }) => id === before[0]!.id)).toMatchObject({
        amountMinor: 20_000,
        categoryId,
        dueDate: "2026-09-10",
        title: "Original title",
      });
      expect(rows.find(({ id }) => id === before[1]!.id)).toMatchObject({
        amountMinor: 30_000,
        categoryId: nextCategoryId,
        dueDate: "2026-10-20",
        status: "pending",
        title: "Updated in place",
      });
      expect(rows.find(({ id }) => id === before[2]!.id)).toMatchObject({
        amountMinor: 30_000,
        categoryId: nextCategoryId,
        dueDate: "2026-11-20",
        status: "pending",
        title: "Updated in place",
      });
    });
  }, 30_000);

  it("pauses without generating and cancels only future unpaid projections", async () => {
    await withFixture(async ({ categoryId, ownerId, transaction }) => {
      const created = await createRecurringExpenseWithOccurrences(transaction, {
        asOf: "2026-09-01",
        ownerId,
        values: initialValues(categoryId),
      });

      await pauseRecurringExpense(transaction, {
        asOf: "2026-10-01",
        ownerId,
        recurringExpenseId: created.id,
      });
      const [paused] = await transaction
        .select({ status: recurringExpenses.status })
        .from(recurringExpenses)
        .where(eq(recurringExpenses.id, created.id));
      expect(paused?.status).toBe("paused");

      await cancelRecurringExpense(transaction, {
        asOf: "2026-10-15",
        ownerId,
        recurringExpenseId: created.id,
      });
      const rows = await transaction
        .select({ dueDate: expenses.dueDate, status: expenses.status })
        .from(expenses)
        .where(eq(expenses.recurringExpenseId, created.id))
        .orderBy(asc(expenses.dueDate));
      expect(rows).toEqual([
        { dueDate: "2026-09-10", status: "pending" },
        { dueDate: "2026-10-10", status: "pending" },
        { dueDate: "2026-11-10", status: "cancelled" },
      ]);
    });
  }, 30_000);

  it("keeps existing projections unchanged when editing a paused template", async () => {
    await withFixture(async ({ categoryId, ownerId, transaction }) => {
      const created = await createRecurringExpenseWithOccurrences(transaction, {
        asOf: "2026-09-01",
        ownerId,
        values: initialValues(categoryId),
      });
      await pauseRecurringExpense(transaction, {
        asOf: "2026-09-01",
        ownerId,
        recurringExpenseId: created.id,
      });

      const updated = await updateRecurringExpenseWithOccurrences(transaction, {
        asOf: "2026-09-01",
        ownerId,
        recurringExpenseId: created.id,
        values: { ...initialValues(categoryId), amountMinor: 99_000 },
      });

      expect(updated.generated).toEqual({
        candidates: 0,
        eligibleTemplates: 0,
        inserted: 0,
        skipped: 0,
      });
      const rows = await transaction
        .select({ amountMinor: expenses.amountMinor, status: expenses.status })
        .from(expenses)
        .where(eq(expenses.recurringExpenseId, created.id));
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.amountMinor === 20_000)).toBe(true);
      expect(rows.every((row) => row.status === "pending")).toBe(true);
    });
  }, 30_000);
});
