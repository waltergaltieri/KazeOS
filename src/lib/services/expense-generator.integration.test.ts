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
import { createAuthenticatedDrizzleRunner } from "@/db/authenticated";

import { generateRecurringExpenses } from "./expense-generator";

config({ path: ".env.local", quiet: true });

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const databaseClient = databaseUrl
  ? postgres(databaseUrl, { prepare: false, max: 1 })
  : undefined;
const database = databaseClient
  ? drizzle({ client: databaseClient, schema })
  : undefined;
const rollback = new Error("ROLLBACK_EXPENSE_GENERATOR_TEST");
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
    if (error !== rollback) throw error;
  }
}

async function seedOwner(transaction: Transaction, label: string) {
  const ownerId = randomUUID();
  const categoryId = randomUUID();

  await transaction.execute(
    drizzleSql`insert into auth.users (id) values (${ownerId})`,
  );
  await transaction.insert(expenseCategories).values({
    id: categoryId,
    name: `Generator ${label} ${categoryId}`,
    ownerId,
  });

  return { categoryId, ownerId };
}

async function seedTemplate(
  transaction: Transaction,
  input: {
    categoryId: string;
    ownerId: string;
    title: string;
    frequency?: "monthly" | "quarterly" | "yearly";
    billingDay?: number;
    startDate?: string;
    endDate?: string | null;
    status?: "active" | "paused" | "cancelled";
    automaticGeneration?: boolean;
  },
) {
  const id = randomUUID();

  await transaction.insert(recurringExpenses).values({
    amountMinor: 45_000,
    automaticGeneration: input.automaticGeneration ?? true,
    billingDay: input.billingDay ?? 31,
    categoryId: input.categoryId,
    costType: "fixed",
    currency: "ARS",
    description: "Abono recurrente",
    endDate: input.endDate ?? null,
    frequency: input.frequency ?? "monthly",
    id,
    notes: "Conservar comprobante",
    ownerId: input.ownerId,
    paymentMethod: "bank_transfer",
    scope: "business",
    startDate: input.startDate ?? "2026-01-01",
    status: input.status ?? "active",
    title: input.title,
    vendor: "Proveedor de prueba",
  });

  return id;
}

afterAll(async () => {
  await databaseClient?.end();
});

describeDatabase("generateRecurringExpenses", () => {
  it("creates monthly, quarterly and yearly pending occurrences inside the three-month horizon", async () => {
    await withRollback(async (transaction) => {
      const owner = await seedOwner(transaction, "schedules");
      const monthlyId = await seedTemplate(transaction, {
        ...owner,
        billingDay: 31,
        endDate: "2026-03-31",
        title: "Internet",
      });
      await seedTemplate(transaction, {
        ...owner,
        billingDay: 15,
        frequency: "quarterly",
        startDate: "2026-01-15",
        title: "Impuestos",
      });
      await seedTemplate(transaction, {
        ...owner,
        billingDay: 1,
        frequency: "yearly",
        startDate: "2026-02-01",
        title: "Seguro",
      });

      await expect(
        generateRecurringExpenses(transaction, {
          asOf: "2026-01-31",
          ownerId: owner.ownerId,
        }),
      ).resolves.toEqual({
        candidates: 5,
        eligibleTemplates: 3,
        inserted: 5,
        skipped: 0,
      });

      const rows = await transaction
        .select({
          amountMinor: expenses.amountMinor,
          categoryId: expenses.categoryId,
          costType: expenses.costType,
          description: expenses.description,
          dueDate: expenses.dueDate,
          generatedAutomatically: expenses.generatedAutomatically,
          notes: expenses.notes,
          paymentMethod: expenses.paymentMethod,
          periodKey: expenses.periodKey,
          recurringExpenseId: expenses.recurringExpenseId,
          scope: expenses.scope,
          status: expenses.status,
          title: expenses.title,
          vendor: expenses.vendor,
        })
        .from(expenses)
        .where(eq(expenses.ownerId, owner.ownerId))
        .orderBy(asc(expenses.dueDate), asc(expenses.title));

      expect(rows).toHaveLength(5);
      expect(
        rows.filter(({ recurringExpenseId }) => recurringExpenseId === monthlyId),
      ).toMatchObject([
        { dueDate: "2026-01-31", periodKey: "monthly:2026-01" },
        { dueDate: "2026-02-28", periodKey: "monthly:2026-02" },
        { dueDate: "2026-03-31", periodKey: "monthly:2026-03" },
      ]);
      expect(rows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            amountMinor: 45_000,
            categoryId: owner.categoryId,
            costType: "fixed",
            description: "Abono recurrente",
            generatedAutomatically: true,
            notes: "Conservar comprobante",
            paymentMethod: "bank_transfer",
            scope: "business",
            status: "pending",
            title: "Internet",
            vendor: "Proveedor de prueba",
          }),
          expect.objectContaining({
            dueDate: "2026-04-15",
            periodKey: "quarterly:2026-Q2",
            title: "Impuestos",
          }),
          expect.objectContaining({
            dueDate: "2026-02-01",
            periodKey: "yearly:2026",
            title: "Seguro",
          }),
        ]),
      );
    });
  }, 30_000);

  it("is idempotent and honors owner/template filters and template eligibility", async () => {
    await withRollback(async (transaction) => {
      const owner = await seedOwner(transaction, "owner");
      const other = await seedOwner(transaction, "other");
      const templateId = await seedTemplate(transaction, {
        ...owner,
        title: "Elegible",
      });
      await seedTemplate(transaction, {
        ...owner,
        automaticGeneration: false,
        title: "Manual",
      });
      await seedTemplate(transaction, {
        ...owner,
        status: "paused",
        title: "Paused",
      });
      await seedTemplate(transaction, {
        ...owner,
        status: "cancelled",
        title: "Cancelled",
      });
      await seedTemplate(transaction, { ...other, title: "Other owner" });

      const input = {
        asOf: "2026-01-01",
        ownerId: owner.ownerId,
        templateId,
      };

      await expect(generateRecurringExpenses(transaction, input)).resolves.toEqual({
        candidates: 3,
        eligibleTemplates: 1,
        inserted: 3,
        skipped: 0,
      });
      await expect(generateRecurringExpenses(transaction, input)).resolves.toEqual({
        candidates: 3,
        eligibleTemplates: 1,
        inserted: 0,
        skipped: 3,
      });
      await expect(
        generateRecurringExpenses(transaction, {
          asOf: input.asOf,
          ownerId: other.ownerId,
          templateId,
        }),
      ).resolves.toEqual({
        candidates: 0,
        eligibleTemplates: 0,
        inserted: 0,
        skipped: 0,
      });

      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);
      await expect(
        runAsOwner(owner.ownerId, (scopedDatabase) =>
          generateRecurringExpenses(scopedDatabase, {
            asOf: input.asOf,
            templateId,
          }),
        ),
      ).resolves.toEqual({
        candidates: 3,
        eligibleTemplates: 1,
        inserted: 0,
        skipped: 3,
      });
    });
  }, 30_000);

  it("uses conflict-safe inserts when two jobs target the same template", async () => {
    const ownerId = randomUUID();
    const categoryId = randomUUID();
    const templateId = randomUUID();
    const firstClient = postgres(databaseUrl!, { prepare: false, max: 1 });
    const secondClient = postgres(databaseUrl!, { prepare: false, max: 1 });
    const firstDatabase = drizzle({ client: firstClient, schema });
    const secondDatabase = drizzle({ client: secondClient, schema });

    try {
      await database!.transaction(async (transaction) => {
        await transaction.execute(
          drizzleSql`insert into auth.users (id) values (${ownerId})`,
        );
        await transaction.insert(expenseCategories).values({
          id: categoryId,
          name: `Concurrency ${categoryId}`,
          ownerId,
        });
        await transaction.insert(recurringExpenses).values({
          amountMinor: 20_000,
          automaticGeneration: true,
          billingDay: 10,
          categoryId,
          costType: "fixed",
          currency: "USD",
          frequency: "monthly",
          id: templateId,
          ownerId,
          scope: "business",
          startDate: "2026-09-01",
          status: "active",
          title: `Concurrency ${templateId}`,
        });
      });

      const results = await Promise.all([
        firstDatabase.transaction((transaction) =>
          generateRecurringExpenses(transaction, {
            asOf: "2026-09-01",
            templateId,
          }),
        ),
        secondDatabase.transaction((transaction) =>
          generateRecurringExpenses(transaction, {
            asOf: "2026-09-01",
            templateId,
          }),
        ),
      ]);

      expect(results.map(({ inserted }) => inserted).sort()).toEqual([0, 3]);
      expect(results.map(({ skipped }) => skipped).sort()).toEqual([0, 3]);
      const generatedRows = await database!
        .select({ id: expenses.id })
        .from(expenses)
        .where(eq(expenses.recurringExpenseId, templateId));
      expect(generatedRows).toHaveLength(3);
    } finally {
      await database!.delete(expenses).where(eq(expenses.recurringExpenseId, templateId));
      await database!.delete(recurringExpenses).where(eq(recurringExpenses.id, templateId));
      await database!.delete(expenseCategories).where(eq(expenseCategories.id, categoryId));
      await database!.execute(
        drizzleSql`delete from auth.users where id = ${ownerId}`,
      );
      await Promise.all([firstClient.end(), secondClient.end()]);
    }
  }, 30_000);
});
