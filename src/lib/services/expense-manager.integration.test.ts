// @vitest-environment node

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
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

import {
  cancelExpense,
  correctPaidExpense,
  createManualExpense,
  deleteManualExpense,
  ExpenseCategoryUnavailableError,
  ExpenseDeleteRestrictedError,
  ExpenseEditLockedError,
  ExpenseNotFoundError,
  ExpensePaymentStateError,
  markExpensePaid,
  updateManualExpense,
} from "./expense-manager";

config({ path: resolve(process.cwd(), "../..", ".env.local"), quiet: true });
process.env.APP_ORIGIN = "http://localhost:3000";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const databaseClient = databaseUrl
  ? postgres(databaseUrl, { prepare: false, max: 2 })
  : undefined;
const database = databaseClient
  ? drizzle({ client: databaseClient, schema })
  : undefined;
const rollback = new Error("ROLLBACK_EXPENSE_MANAGER_TEST");

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

async function createFixture(transaction: Transaction) {
  const ownerId = randomUUID();
  const otherOwnerId = randomUUID();
  const categoryId = randomUUID();
  const inactiveCategoryId = randomUUID();
  const otherCategoryId = randomUUID();

  await transaction.execute(
    sql`insert into auth.users (id) values (${ownerId}), (${otherOwnerId})`,
  );
  await transaction.insert(expenseCategories).values([
    { id: categoryId, ownerId, name: `Activa ${randomUUID()}` },
    { id: inactiveCategoryId, ownerId, name: `Inactiva ${randomUUID()}`, active: false },
    { id: otherCategoryId, ownerId: otherOwnerId, name: `Ajena ${randomUUID()}` },
  ]);

  return { categoryId, inactiveCategoryId, otherCategoryId, otherOwnerId, ownerId };
}

function manualValues(categoryId: string) {
  return {
    amountMinor: 12_500,
    categoryId,
    costType: "variable" as const,
    currency: "ARS" as const,
    description: "Compra de insumos",
    dueDate: "2026-09-20",
    notes: "Factura pendiente",
    paidDate: null,
    paymentMethod: null,
    recurring: false as const,
    scope: "business" as const,
    status: "pending" as const,
    title: "Insumos",
    vendor: "Proveedor",
  };
}

afterAll(async () => databaseClient?.end());

describeDatabase("expense manager", () => {
  it("holds the category stable until manual creation commits", async () => {
    const ownerId = randomUUID();
    const categoryId = randomUUID();
    let releaseCreation!: () => void;
    let signalCreated!: () => void;
    const release = new Promise<void>((resolveRelease) => {
      releaseCreation = resolveRelease;
    });
    const created = new Promise<void>((resolveCreated) => {
      signalCreated = resolveCreated;
    });

    await database!.execute(sql`insert into auth.users (id) values (${ownerId})`);
    await database!.insert(expenseCategories).values({
      id: categoryId,
      name: `Concurrente ${randomUUID()}`,
      ownerId,
    });

    const creation = database!.transaction(async (transaction) => {
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);
      await runAsOwner(ownerId, (ownerDb) => createManualExpense(ownerDb, {
        ownerId,
        values: manualValues(categoryId),
      }));
      signalCreated();
      await release;
    });

    try {
      await created;
      await expect(database!.transaction(async (transaction) => {
        await transaction.execute(sql`set local lock_timeout = '500ms'`);
        await transaction.update(expenseCategories)
          .set({ active: false })
          .where(eq(expenseCategories.id, categoryId));
      })).rejects.toMatchObject({ cause: { code: "55P03" } });
    } finally {
      releaseCreation();
      await creation;
      await database!.delete(expenses).where(eq(expenses.ownerId, ownerId));
      await database!.delete(expenseCategories).where(eq(expenseCategories.ownerId, ownerId));
      await database!.execute(sql`delete from auth.users where id = ${ownerId}`);
    }
  }, 30_000);

  it("creates manual planned or pending expenses with safe one-off identity", async () => {
    await withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);

      const pending = await runAsOwner(fixture.ownerId, (ownerDb) =>
        createManualExpense(ownerDb, {
          ownerId: fixture.ownerId,
          values: manualValues(fixture.categoryId),
        }),
      );
      const planned = await runAsOwner(fixture.ownerId, (ownerDb) =>
        createManualExpense(ownerDb, {
          ownerId: fixture.ownerId,
          values: { ...manualValues(fixture.categoryId), status: "planned" },
        }),
      );

      const rows = await transaction.select().from(expenses)
        .where(sql`${expenses.id} in (${pending.id}, ${planned.id})`);
      expect(rows).toEqual(expect.arrayContaining([
        expect.objectContaining({
          generatedAutomatically: false,
          paidDate: null,
          periodKey: null,
          recurringExpenseId: null,
          status: "pending",
        }),
        expect.objectContaining({ status: "planned" }),
      ]));
    });
  }, 30_000);

  it("rejects inactive and foreign categories on create and update", async () => {
    await withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);

      for (const categoryId of [fixture.inactiveCategoryId, fixture.otherCategoryId]) {
        await expect(runAsOwner(fixture.ownerId, (ownerDb) =>
          createManualExpense(ownerDb, {
            ownerId: fixture.ownerId,
            values: manualValues(categoryId),
          }),
        )).rejects.toBeInstanceOf(ExpenseCategoryUnavailableError);
      }

      const created = await runAsOwner(fixture.ownerId, (ownerDb) =>
        createManualExpense(ownerDb, {
          ownerId: fixture.ownerId,
          values: manualValues(fixture.categoryId),
        }),
      );
      await expect(runAsOwner(fixture.ownerId, (ownerDb) =>
        updateManualExpense(ownerDb, {
          expenseId: created.id,
          ownerId: fixture.ownerId,
          values: { ...manualValues(fixture.inactiveCategoryId), title: "No permitido" },
        }),
      )).rejects.toBeInstanceOf(ExpenseCategoryUnavailableError);
    });
  }, 30_000);

  it("treats every mutation of another owner's expense as not found", async () => {
    await withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const foreignExpenseId = randomUUID();
      await transaction.insert(expenses).values({
        amountMinor: 10_000,
        categoryId: fixture.otherCategoryId,
        costType: "variable",
        currency: "USD",
        dueDate: "2026-09-20",
        id: foreignExpenseId,
        ownerId: fixture.otherOwnerId,
        scope: "personal",
        title: "Gasto ajeno",
      });
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);
      const payment = {
        amountMinor: 10_000,
        expenseId: foreignExpenseId,
        paidDate: "2026-09-20",
        paymentMethod: "cash" as const,
      };
      const operations = [
        (ownerDb: Parameters<Parameters<typeof runAsOwner>[1]>[0]) =>
          updateManualExpense(ownerDb, {
            expenseId: foreignExpenseId,
            ownerId: fixture.ownerId,
            values: manualValues(fixture.categoryId),
          }),
        (ownerDb: Parameters<Parameters<typeof runAsOwner>[1]>[0]) =>
          markExpensePaid(ownerDb, {
            expenseId: foreignExpenseId,
            ownerId: fixture.ownerId,
            values: payment,
          }),
        (ownerDb: Parameters<Parameters<typeof runAsOwner>[1]>[0]) =>
          correctPaidExpense(ownerDb, {
            expenseId: foreignExpenseId,
            ownerId: fixture.ownerId,
            values: payment,
          }),
        (ownerDb: Parameters<Parameters<typeof runAsOwner>[1]>[0]) =>
          cancelExpense(ownerDb, {
            expenseId: foreignExpenseId,
            ownerId: fixture.ownerId,
          }),
        (ownerDb: Parameters<Parameters<typeof runAsOwner>[1]>[0]) =>
          deleteManualExpense(ownerDb, {
            expenseId: foreignExpenseId,
            ownerId: fixture.ownerId,
          }),
      ];

      for (const operation of operations) {
        await expect(runAsOwner(fixture.ownerId, operation))
          .rejects.toBeInstanceOf(ExpenseNotFoundError);
      }
      expect((await transaction.select().from(expenses)
        .where(eq(expenses.id, foreignExpenseId)))[0])
        .toMatchObject({ amountMinor: 10_000, status: "pending" });
    });
  }, 30_000);

  it("retains an existing inactive category while editing its manual expense", async () => {
    await withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);
      const created = await runAsOwner(fixture.ownerId, (ownerDb) =>
        createManualExpense(ownerDb, {
          ownerId: fixture.ownerId,
          values: manualValues(fixture.categoryId),
        }),
      );
      await transaction.update(expenseCategories)
        .set({ active: false })
        .where(eq(expenseCategories.id, fixture.categoryId));

      await expect(runAsOwner(fixture.ownerId, (ownerDb) =>
        updateManualExpense(ownerDb, {
          expenseId: created.id,
          ownerId: fixture.ownerId,
          values: {
            ...manualValues(fixture.categoryId),
            title: "Histórico actualizado",
          },
        }),
      )).resolves.toEqual({ id: created.id });
    });
  }, 30_000);

  it("updates only unpaid manual expenses", async () => {
    await withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);
      const created = await runAsOwner(fixture.ownerId, (ownerDb) =>
        createManualExpense(ownerDb, {
          ownerId: fixture.ownerId,
          values: manualValues(fixture.categoryId),
        }),
      );

      await runAsOwner(fixture.ownerId, (ownerDb) => updateManualExpense(ownerDb, {
        expenseId: created.id,
        ownerId: fixture.ownerId,
        values: {
          ...manualValues(fixture.categoryId),
          amountMinor: 20_000,
          status: "planned",
          title: "Insumos actualizados",
        },
      }));

      await expect(transaction.select().from(expenses).where(eq(expenses.id, created.id)))
        .resolves.toEqual([
          expect.objectContaining({
            amountMinor: 20_000,
            status: "planned",
            title: "Insumos actualizados",
          }),
        ]);

      await runAsOwner(fixture.ownerId, (ownerDb) => markExpensePaid(ownerDb, {
        expenseId: created.id,
        ownerId: fixture.ownerId,
        values: {
          amountMinor: 20_000,
          expenseId: created.id,
          paidDate: "2026-09-19",
          paymentMethod: "bank_transfer",
        },
      }));
      await expect(runAsOwner(fixture.ownerId, (ownerDb) =>
        updateManualExpense(ownerDb, {
          expenseId: created.id,
          ownerId: fixture.ownerId,
          values: manualValues(fixture.categoryId),
        }),
      )).rejects.toBeInstanceOf(ExpenseEditLockedError);

      const recurringExpenseId = randomUUID();
      const generatedId = randomUUID();
      await transaction.insert(recurringExpenses).values({
        amountMinor: 10_000,
        billingDay: 20,
        categoryId: fixture.categoryId,
        costType: "fixed",
        currency: "ARS",
        frequency: "monthly",
        id: recurringExpenseId,
        ownerId: fixture.ownerId,
        scope: "business",
        startDate: "2026-09-01",
        title: "Alquiler",
      });
      await transaction.insert(expenses).values({
        amountMinor: 10_000,
        categoryId: fixture.categoryId,
        costType: "fixed",
        currency: "ARS",
        dueDate: "2026-09-20",
        generatedAutomatically: true,
        id: generatedId,
        ownerId: fixture.ownerId,
        periodKey: "monthly:2026-09",
        recurringExpenseId,
        scope: "business",
        title: "Alquiler",
      });
      await expect(runAsOwner(fixture.ownerId, (ownerDb) =>
        updateManualExpense(ownerDb, {
          expenseId: generatedId,
          ownerId: fixture.ownerId,
          values: manualValues(fixture.categoryId),
        }),
      )).rejects.toBeInstanceOf(ExpenseEditLockedError);
    });
  }, 30_000);

  it("marks an expense paid atomically and corrects it only through the paid path", async () => {
    await withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);
      const created = await runAsOwner(fixture.ownerId, (ownerDb) =>
        createManualExpense(ownerDb, {
          ownerId: fixture.ownerId,
          values: manualValues(fixture.categoryId),
        }),
      );

      await runAsOwner(fixture.ownerId, (ownerDb) => markExpensePaid(ownerDb, {
        expenseId: created.id,
        ownerId: fixture.ownerId,
        values: {
          amountMinor: 13_750,
          expenseId: created.id,
          paidDate: "2026-09-21",
          paymentMethod: "credit_card",
        },
      }));
      expect((await transaction.select().from(expenses).where(eq(expenses.id, created.id)))[0])
        .toMatchObject({
          amountMinor: 13_750,
          paidDate: "2026-09-21",
          paymentMethod: "credit_card",
          status: "paid",
        });

      await expect(runAsOwner(fixture.ownerId, (ownerDb) => markExpensePaid(ownerDb, {
        expenseId: created.id,
        ownerId: fixture.ownerId,
        values: {
          amountMinor: 14_000,
          expenseId: created.id,
          paidDate: "2026-09-22",
          paymentMethod: "cash",
        },
      }))).rejects.toBeInstanceOf(ExpensePaymentStateError);

      await runAsOwner(fixture.ownerId, (ownerDb) => correctPaidExpense(ownerDb, {
        expenseId: created.id,
        ownerId: fixture.ownerId,
        values: {
          amountMinor: 14_000,
          expenseId: created.id,
          paidDate: "2026-09-22",
          paymentMethod: "cash",
        },
      }));
      expect((await transaction.select().from(expenses).where(eq(expenses.id, created.id)))[0])
        .toMatchObject({
          amountMinor: 14_000,
          paidDate: "2026-09-22",
          paymentMethod: "cash",
          status: "paid",
        });
    });
  }, 30_000);

  it("duplicates through manual creation without paid or recurrence metadata", async () => {
    await withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);
      const duplicate = await runAsOwner(fixture.ownerId, (ownerDb) =>
        createManualExpense(ownerDb, {
          ownerId: fixture.ownerId,
          values: {
            ...manualValues(fixture.categoryId),
            paidDate: null,
            paymentMethod: null,
            status: "pending",
            title: "Insumos (copia)",
          },
        }),
      );

      expect((await transaction.select().from(expenses).where(eq(expenses.id, duplicate.id)))[0])
        .toMatchObject({
          generatedAutomatically: false,
          paidDate: null,
          paymentMethod: null,
          periodKey: null,
          recurringExpenseId: null,
          status: "pending",
        });
    });
  }, 30_000);

  it("cancels retained history and deletes only manual planned or pending rows", async () => {
    await withRollback(async (transaction) => {
      const fixture = await createFixture(transaction);
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);
      const cancellable = await runAsOwner(fixture.ownerId, (ownerDb) =>
        createManualExpense(ownerDb, {
          ownerId: fixture.ownerId,
          values: manualValues(fixture.categoryId),
        }),
      );
      await runAsOwner(fixture.ownerId, (ownerDb) => cancelExpense(ownerDb, {
        expenseId: cancellable.id,
        ownerId: fixture.ownerId,
      }));
      expect((await transaction.select().from(expenses).where(eq(expenses.id, cancellable.id)))[0]?.status)
        .toBe("cancelled");
      await expect(runAsOwner(fixture.ownerId, (ownerDb) => deleteManualExpense(ownerDb, {
        expenseId: cancellable.id,
        ownerId: fixture.ownerId,
      }))).rejects.toBeInstanceOf(ExpenseDeleteRestrictedError);

      const paid = await runAsOwner(fixture.ownerId, (ownerDb) =>
        createManualExpense(ownerDb, {
          ownerId: fixture.ownerId,
          values: manualValues(fixture.categoryId),
        }),
      );
      await runAsOwner(fixture.ownerId, (ownerDb) => markExpensePaid(ownerDb, {
        expenseId: paid.id,
        ownerId: fixture.ownerId,
        values: {
          amountMinor: 12_500,
          expenseId: paid.id,
          paidDate: "2026-09-20",
          paymentMethod: "cash",
        },
      }));
      await expect(runAsOwner(fixture.ownerId, (ownerDb) => deleteManualExpense(ownerDb, {
        expenseId: paid.id,
        ownerId: fixture.ownerId,
      }))).rejects.toBeInstanceOf(ExpenseDeleteRestrictedError);

      const recurringExpenseId = randomUUID();
      const generatedId = randomUUID();
      await transaction.insert(recurringExpenses).values({
        amountMinor: 10_000,
        billingDay: 20,
        categoryId: fixture.categoryId,
        costType: "fixed",
        currency: "ARS",
        frequency: "monthly",
        id: recurringExpenseId,
        ownerId: fixture.ownerId,
        scope: "business",
        startDate: "2026-09-01",
        title: "Alquiler",
      });
      await transaction.insert(expenses).values({
        amountMinor: 10_000,
        categoryId: fixture.categoryId,
        costType: "fixed",
        currency: "ARS",
        dueDate: "2026-09-20",
        generatedAutomatically: true,
        id: generatedId,
        ownerId: fixture.ownerId,
        periodKey: "monthly:2026-09",
        recurringExpenseId,
        scope: "business",
        title: "Alquiler",
      });
      await expect(runAsOwner(fixture.ownerId, (ownerDb) => deleteManualExpense(ownerDb, {
        expenseId: generatedId,
        ownerId: fixture.ownerId,
      }))).rejects.toBeInstanceOf(ExpenseDeleteRestrictedError);
      await runAsOwner(fixture.ownerId, (ownerDb) => cancelExpense(ownerDb, {
        expenseId: generatedId,
        ownerId: fixture.ownerId,
      }));
      expect((await transaction.select().from(expenses).where(eq(expenses.id, generatedId)))[0])
        .toMatchObject({ generatedAutomatically: true, status: "cancelled" });

      const deletable = await runAsOwner(fixture.ownerId, (ownerDb) =>
        createManualExpense(ownerDb, {
          ownerId: fixture.ownerId,
          values: { ...manualValues(fixture.categoryId), status: "planned" },
        }),
      );
      await runAsOwner(fixture.ownerId, (ownerDb) => deleteManualExpense(ownerDb, {
        expenseId: deletable.id,
        ownerId: fixture.ownerId,
      }));
      await expect(transaction.select().from(expenses).where(eq(expenses.id, deletable.id)))
        .resolves.toHaveLength(0);
    });
  }, 30_000);
});
