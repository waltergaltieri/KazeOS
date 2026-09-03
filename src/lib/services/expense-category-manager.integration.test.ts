// @vitest-environment node

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ withAuthenticatedDb: vi.fn() }));

import { createAuthenticatedDrizzleRunner } from "@/db/authenticated";
import * as schema from "@/db/schema";
import { expenseCategories, expenses } from "@/db/schema";
import { queryExpenseCategories } from "@/lib/queries/expense-categories";

import {
  assertActiveExpenseCategory,
  createExpenseCategory,
  ExpenseCategoryDuplicateError,
  ExpenseCategoryInactiveError,
  ExpenseCategoryNotFoundError,
  toggleExpenseCategory,
  updateExpenseCategory,
} from "./expense-category-manager";

config({ path: resolve(process.cwd(), "..", "..", ".env.local"), quiet: true });
process.env.APP_ORIGIN ??= "http://localhost:3000";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const databaseClient = databaseUrl
  ? postgres(databaseUrl, { prepare: false, max: 3 })
  : undefined;
const database = databaseClient
  ? drizzle({ client: databaseClient, schema })
  : undefined;
const rollback = new Error("ROLLBACK_EXPENSE_CATEGORY_MANAGER_TEST");
type Database = NonNullable<typeof database>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForBlockedBackend(pid: number) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const [row] = await database!.execute(sql<{ waiting: boolean }>`
      select exists (
        select 1 from pg_locks
        where pid = ${pid} and granted = false
      ) as waiting
    `);
    if (row?.waiting) return;
    await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
  }

  throw new Error(`Backend ${pid} did not wait for the category lock`);
}

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

async function createOwners(transaction: Transaction) {
  const firstOwnerId = randomUUID();
  const secondOwnerId = randomUUID();
  await transaction.execute(
    sql`insert into auth.users (id) values (${firstOwnerId}), (${secondOwnerId})`,
  );
  return { firstOwnerId, secondOwnerId };
}

afterAll(async () => databaseClient?.end());

describeDatabase("transactional expense category management", () => {
  it("lists active categories alphabetically and optionally includes inactive history for only one owner", async () => {
    await withRollback(async (transaction) => {
      const { firstOwnerId, secondOwnerId } = await createOwners(transaction);
      await transaction.insert(expenseCategories).values([
        { ownerId: firstOwnerId, name: `Zulu ${randomUUID()}` },
        { ownerId: firstOwnerId, name: `alfa ${randomUUID()}` },
        { ownerId: firstOwnerId, name: `Legado ${randomUUID()}`, active: false },
        { ownerId: secondOwnerId, name: `Ajena ${randomUUID()}` },
      ]);
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);

      const active = await runAsOwner(firstOwnerId, (db) =>
        queryExpenseCategories(db, firstOwnerId),
      );
      const includingInactive = await runAsOwner(firstOwnerId, (db) =>
        queryExpenseCategories(db, firstOwnerId, { includeInactive: true }),
      );

      expect(active).toHaveLength(2);
      expect(active.map((category) => category.name.split(" ")[0])).toEqual([
        "alfa",
        "Zulu",
      ]);
      expect(includingInactive).toHaveLength(3);
      expect(includingInactive.map((category) => category.active)).toEqual([
        true,
        true,
        false,
      ]);
      expect(includingInactive.every((category) => !category.name.startsWith("Ajena")))
        .toBe(true);
    });
  }, 30_000);

  it("normalizes create and rename while rejecting case-insensitive duplicates per owner", async () => {
    await withRollback(async (transaction) => {
      const { firstOwnerId, secondOwnerId } = await createOwners(transaction);
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);

      const first = await runAsOwner(firstOwnerId, (db) =>
        createExpenseCategory(db, {
          ownerId: firstOwnerId,
          values: { name: "  Software  ", icon: "  app-window  " },
        }),
      );
      await runAsOwner(secondOwnerId, (db) =>
        createExpenseCategory(db, {
          ownerId: secondOwnerId,
          values: { name: "software", icon: null },
        }),
      );
      await runAsOwner(firstOwnerId, (db) =>
        createExpenseCategory(db, {
          ownerId: firstOwnerId,
          values: { name: "Servicios", icon: null },
        }),
      );

      await expect(runAsOwner(firstOwnerId, (db) =>
        createExpenseCategory(db, {
          ownerId: firstOwnerId,
          values: { name: "SOFTWARE", icon: null },
        }),
      )).rejects.toBeInstanceOf(ExpenseCategoryDuplicateError);
      await expect(runAsOwner(firstOwnerId, (db) =>
        updateExpenseCategory(db, {
          categoryId: first.id,
          ownerId: firstOwnerId,
          values: { name: "  SERVICIOS  ", icon: null },
        }),
      )).rejects.toBeInstanceOf(ExpenseCategoryDuplicateError);

      await runAsOwner(firstOwnerId, (db) =>
        updateExpenseCategory(db, {
          categoryId: first.id,
          ownerId: firstOwnerId,
          values: { name: "  Herramientas  ", icon: "  " },
        }),
      );

      const [stored] = await transaction
        .select({ name: expenseCategories.name, icon: expenseCategories.icon })
        .from(expenseCategories)
        .where(and(
          eq(expenseCategories.ownerId, firstOwnerId),
          eq(expenseCategories.id, first.id),
        ));
      expect(stored).toEqual({ name: "Herramientas", icon: null });
    });
  }, 30_000);

  it("never mutates another owner's category", async () => {
    await withRollback(async (transaction) => {
      const { firstOwnerId, secondOwnerId } = await createOwners(transaction);
      const [category] = await transaction.insert(expenseCategories).values({
        ownerId: firstOwnerId,
        name: `Privada ${randomUUID()}`,
      }).returning({ id: expenseCategories.id });
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);

      await expect(runAsOwner(secondOwnerId, (db) =>
        updateExpenseCategory(db, {
          categoryId: category!.id,
          ownerId: secondOwnerId,
          values: { name: "Intrusión", icon: null },
        }),
      )).rejects.toBeInstanceOf(ExpenseCategoryNotFoundError);

      const [stored] = await transaction.select({ name: expenseCategories.name })
        .from(expenseCategories)
        .where(eq(expenseCategories.id, category!.id));
      expect(stored?.name).toMatch(/^Privada /);
    });
  }, 30_000);

  it("deactivates and restores a category without deleting referenced history", async () => {
    await withRollback(async (transaction) => {
      const { firstOwnerId } = await createOwners(transaction);
      const [category] = await transaction.insert(expenseCategories).values({
        ownerId: firstOwnerId,
        name: `Histórica ${randomUUID()}`,
      }).returning({ id: expenseCategories.id });
      const [expense] = await transaction.insert(expenses).values({
        ownerId: firstOwnerId,
        title: "Comprobante histórico",
        amountMinor: 1_000,
        currency: "USD",
        categoryId: category!.id,
        scope: "business",
        costType: "fixed",
        dueDate: "2026-09-02",
      }).returning({ id: expenses.id });
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);

      await runAsOwner(firstOwnerId, (db) => toggleExpenseCategory(db, {
        categoryId: category!.id,
        ownerId: firstOwnerId,
        active: false,
      }));
      await expect(runAsOwner(firstOwnerId, (db) =>
        assertActiveExpenseCategory(db, {
          categoryId: category!.id,
          ownerId: firstOwnerId,
        }),
      )).rejects.toBeInstanceOf(ExpenseCategoryInactiveError);

      expect(await transaction.select({ id: expenses.id }).from(expenses)
        .where(eq(expenses.id, expense!.id))).toEqual([{ id: expense!.id }]);

      await runAsOwner(firstOwnerId, (db) => toggleExpenseCategory(db, {
        categoryId: category!.id,
        ownerId: firstOwnerId,
        active: true,
      }));
      await expect(runAsOwner(firstOwnerId, (db) =>
        assertActiveExpenseCategory(db, {
          categoryId: category!.id,
          ownerId: firstOwnerId,
        }),
      )).resolves.toMatchObject({ id: category!.id, active: true });
    });
  }, 30_000);

  it("serializes deactivation behind active-category validation until the expense write commits", async () => {
    const ownerId = randomUUID();
    const categoryId = randomUUID();
    const expenseId = randomUUID();
    const validationComplete = deferred();
    const allowExpenseWrite = deferred();
    const deactivationStarted = deferred();
    const deactivationFinished = deferred();
    let deactivationPid = 0;
    let deactivationCompleted = false;
    let expenseWrite: Promise<unknown> | undefined;
    let deactivation: Promise<unknown> | undefined;

    await database!.execute(sql`insert into auth.users (id) values (${ownerId})`);
    await database!.insert(expenseCategories).values({
      id: categoryId,
      ownerId,
      name: `Concurrent ${randomUUID()}`,
    });

    try {
      const runAsOwner = createAuthenticatedDrizzleRunner(database!);
      expenseWrite = runAsOwner(ownerId, async (db) => {
        await assertActiveExpenseCategory(db, { categoryId, ownerId });
        validationComplete.resolve();
        await allowExpenseWrite.promise;
        return db.insert(expenses).values({
          id: expenseId,
          ownerId,
          title: "Gasto concurrente",
          amountMinor: 1_000,
          currency: "USD",
          categoryId,
          scope: "business",
          costType: "fixed",
          dueDate: "2026-09-02",
        });
      });

      await validationComplete.promise;
      deactivation = runAsOwner(ownerId, async (db) => {
        const [backend] = await db.execute(sql<{ pid: number }>`
          select pg_backend_pid()::integer as pid
        `);
        const pid = Number(backend?.pid);
        if (!Number.isSafeInteger(pid) || pid <= 0) {
          throw new Error("Database did not return a valid backend pid");
        }
        deactivationPid = pid;
        deactivationStarted.resolve();
        const result = await toggleExpenseCategory(db, {
          active: false,
          categoryId,
          ownerId,
        });
        deactivationCompleted = true;
        deactivationFinished.resolve();
        return result;
      });

      await deactivationStarted.promise;
      const concurrencyState = await Promise.race([
        waitForBlockedBackend(deactivationPid).then(() => "blocked" as const),
        deactivationFinished.promise.then(() => "completed" as const),
      ]);
      expect(concurrencyState).toBe("blocked");
      expect(deactivationCompleted).toBe(false);

      allowExpenseWrite.resolve();
      await Promise.all([expenseWrite, deactivation]);

      const [category] = await database!.select({ active: expenseCategories.active })
        .from(expenseCategories)
        .where(and(
          eq(expenseCategories.id, categoryId),
          eq(expenseCategories.ownerId, ownerId),
        ));
      const storedExpenses = await database!.select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.id, expenseId), eq(expenses.ownerId, ownerId)));

      expect(category?.active).toBe(false);
      expect(storedExpenses).toEqual([{ id: expenseId }]);
    } finally {
      allowExpenseWrite.resolve();
      await Promise.allSettled(
        [expenseWrite, deactivation].filter(
          (operation): operation is Promise<unknown> => operation !== undefined,
        ),
      );
      await database!.delete(expenses).where(eq(expenses.ownerId, ownerId));
      await database!.delete(expenseCategories)
        .where(eq(expenseCategories.ownerId, ownerId));
      await database!.execute(sql`delete from auth.users where id = ${ownerId}`);
    }
  }, 30_000);
});
