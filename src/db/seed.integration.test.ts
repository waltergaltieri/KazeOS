// @vitest-environment node

import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAuthenticatedDrizzleRunner } from "./authenticated";
import * as schema from "./schema";
import {
  charges,
  clientNotes,
  clients,
  expenseCategories,
  expenses,
  payments,
  recurringExpenses,
  services,
  tasks,
} from "./schema";
import { createDemoSeedData, DEMO_SEED_REFERENCE_DATE, seedDemoData } from "./seed-data";
import { runDemoSeed } from "./seed";

config({ path: ".env.local", quiet: true });
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? postgres(databaseUrl, { prepare: false, max: 1 }) : undefined;
const database = client ? drizzle({ client, schema }) : undefined;
type Database = NonNullable<typeof database>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const rollback = new Error("ROLLBACK_DEMO_SEED");
afterAll(async () => client?.end());

describeDatabase("safe idempotent demo seed through RLS", () => {
  it("refuses an explicit owner UUID that is not an existing auth user", async () => {
    await expect(runDemoSeed({ DATABASE_URL: databaseUrl!, ALLOW_DEMO_SEED: "true", SEED_OWNER_ID: randomUUID() })).rejects.toThrow(/existing Supabase auth user/);
  }, 30_000);

  it("reconciles twice without duplicates, isolates owners and leaves no residue", async () => {
    try {
      await database!.transaction(async (transaction: Transaction) => {
        const ownerId = randomUUID();
        const otherOwnerId = randomUUID();
        const otherClientId = randomUUID();
        const preexistingSoftwareCategoryId = randomUUID();
        await transaction.execute(sql`insert into auth.users (id, email) values (${ownerId}, ${`seed-${ownerId}@example.invalid`}), (${otherOwnerId}, ${`seed-${otherOwnerId}@example.invalid`})`);
        await transaction.insert(clients).values({ id: otherClientId, ownerId: otherOwnerId, firstName: "No visible" });

        const runAsOwner = createAuthenticatedDrizzleRunner(transaction);
        await runAsOwner(ownerId, (ownerDatabase) =>
          ownerDatabase.insert(expenseCategories).values({
            active: false,
            icon: "existing-icon",
            id: preexistingSoftwareCategoryId,
            name: "sOfTwArE",
            ownerId,
          }),
        );
        const first = await runAsOwner(ownerId, (ownerDatabase) => seedDemoData(ownerDatabase, ownerId));
        const expected = createDemoSeedData(ownerId);
        const vercelTemplate = expected.recurringExpenses.find(
          ({ title }) => title === "Vercel",
        )!;
        const [vercelOccurrence] = expected.expenses.filter(
          ({ recurringExpenseId }) => recurringExpenseId === vercelTemplate.id,
        );
        const dinnerExpense = expected.expenses.find(
          ({ title }) => title === "Cena",
        )!;

        await runAsOwner(ownerId, async (ownerDatabase) => {
          await ownerDatabase
            .update(recurringExpenses)
            .set({
              amountMinor: 2_500,
              notes: "Plantilla pausada después del seed inicial",
              status: "paused",
            })
            .where(eq(recurringExpenses.id, vercelTemplate.id));
          await ownerDatabase
            .update(expenses)
            .set({
              amountMinor: 4_250_000,
              notes: "Cena corregida después del seed inicial",
              paidDate: "2026-08-29",
            })
            .where(eq(expenses.id, dinnerExpense.id));
          await ownerDatabase
            .update(expenses)
            .set({
              notes: "Pago confirmado después del seed inicial",
              paidDate: "2026-09-04",
              paymentMethod: "credit_card",
              status: "paid",
            })
            .where(eq(expenses.id, vercelOccurrence!.id));
        });

        const second = await runAsOwner(ownerId, (ownerDatabase) => seedDemoData(ownerDatabase, ownerId.toUpperCase()));
        expect(second).toEqual(first);

        await runAsOwner(ownerId, async (ownerDatabase) => {
          const [identity] = await ownerDatabase.execute<{ current_user: string; auth_uid: string }>(sql`select current_user, auth.uid()::text as auth_uid`);
          expect(identity).toEqual({ current_user: "kazeos_backend", auth_uid: ownerId });

          const count = async (table: typeof clients | typeof services | typeof charges | typeof payments | typeof tasks | typeof clientNotes | typeof expenseCategories | typeof recurringExpenses | typeof expenses) => {
            const [row] = await ownerDatabase.select({ value: sql<number>`count(*)::int` }).from(table).where(eq(table.ownerId, ownerId));
            return row?.value;
          };
          await expect(Promise.all([count(clients), count(services), count(charges), count(payments), count(tasks), count(clientNotes), count(expenseCategories), count(recurringExpenses), count(expenses)])).resolves.toEqual([
            expected.clients.length, expected.services.length, expected.charges.length, expected.payments.length, expected.tasks.length, expected.notes.length, expected.expenseCategories.length, expected.recurringExpenses.length, expected.expenses.length,
          ]);

          const rows = await ownerDatabase.select({ description: charges.description, amountMinor: charges.amountMinor, amountPaidMinor: charges.amountPaidMinor, status: charges.status, dueDate: charges.dueDate }).from(charges).where(eq(charges.ownerId, ownerId));
          const states = rows.map((charge) => charge.status === "paid" || charge.status === "partial" ? charge.status : charge.dueDate < DEMO_SEED_REFERENCE_DATE ? "overdue" : "pending");
          expect(new Set(states)).toEqual(new Set(["paid", "partial", "overdue", "pending"]));
          expect(rows.find((row) => row.status === "paid")?.amountPaidMinor).toBe(rows.find((row) => row.status === "paid")?.amountMinor);
          await expect(
            ownerDatabase
              .select({
                active: expenseCategories.active,
                icon: expenseCategories.icon,
                id: expenseCategories.id,
                name: expenseCategories.name,
              })
              .from(expenseCategories)
              .where(eq(expenseCategories.id, preexistingSoftwareCategoryId)),
          ).resolves.toEqual([
            {
              active: false,
              icon: "existing-icon",
              id: preexistingSoftwareCategoryId,
              name: "sOfTwArE",
            },
          ]);
          await expect(
            ownerDatabase
              .select({ categoryId: recurringExpenses.categoryId })
              .from(recurringExpenses)
              .where(eq(recurringExpenses.id, vercelTemplate.id)),
          ).resolves.toEqual([
            { categoryId: preexistingSoftwareCategoryId },
          ]);
          const vercelCategoryReferences = await ownerDatabase
            .select({ categoryId: expenses.categoryId })
            .from(expenses)
            .where(eq(expenses.recurringExpenseId, vercelTemplate.id));
          expect(new Set(vercelCategoryReferences.map(({ categoryId }) => categoryId))).toEqual(
            new Set([preexistingSoftwareCategoryId]),
          );
          await expect(
            ownerDatabase
              .select({
                amountMinor: recurringExpenses.amountMinor,
                notes: recurringExpenses.notes,
                status: recurringExpenses.status,
              })
              .from(recurringExpenses)
              .where(eq(recurringExpenses.id, vercelTemplate.id)),
          ).resolves.toEqual([
            {
              amountMinor: 2_500,
              notes: "Plantilla pausada después del seed inicial",
              status: "paused",
            },
          ]);
          await expect(
            ownerDatabase
              .select({
                amountMinor: expenses.amountMinor,
                notes: expenses.notes,
                paidDate: expenses.paidDate,
              })
              .from(expenses)
              .where(eq(expenses.id, dinnerExpense.id)),
          ).resolves.toEqual([
            {
              amountMinor: 4_250_000,
              notes: "Cena corregida después del seed inicial",
              paidDate: "2026-08-29",
            },
          ]);
          await expect(
            ownerDatabase
              .select({
                notes: expenses.notes,
                paidDate: expenses.paidDate,
                paymentMethod: expenses.paymentMethod,
                status: expenses.status,
              })
              .from(expenses)
              .where(eq(expenses.id, vercelOccurrence!.id)),
          ).resolves.toEqual([
            {
              notes: "Pago confirmado después del seed inicial",
              paidDate: "2026-09-04",
              paymentMethod: "credit_card",
              status: "paid",
            },
          ]);
          expect(await ownerDatabase.select({ id: clients.id }).from(clients).where(and(eq(clients.ownerId, otherOwnerId), eq(clients.id, otherClientId)))).toEqual([]);
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }, 45_000);
});
