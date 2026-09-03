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
import { expenseCategories } from "@/db/schema";

config({ path: resolve(process.cwd(), "../..", ".env.local"), quiet: true });
process.env.APP_ORIGIN = "http://localhost:3000";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const databaseClient = databaseUrl
  ? postgres(databaseUrl, { prepare: false, max: 1 })
  : undefined;
const database = databaseClient
  ? drizzle({ client: databaseClient, schema })
  : undefined;
const rollback = new Error("ROLLBACK_EXPENSE_BACKEND_TEST");

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

describeDatabase("private expense backend authorization", () => {
  it("keeps direct authenticated table privileges read-only", async () => {
    const rows = await database!.execute(sql<{
      authenticated_delete: boolean;
      authenticated_insert: boolean;
      authenticated_select: boolean;
      authenticated_update: boolean;
      backend_delete: boolean;
      backend_insert: boolean;
      backend_update: boolean;
      table_name: string;
    }>`
      select
        table_name,
        has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT') as authenticated_select,
        has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT') as authenticated_insert,
        has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE') as authenticated_update,
        has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') as authenticated_delete,
        has_table_privilege('kazeos_backend', format('public.%I', table_name), 'INSERT') as backend_insert,
        has_table_privilege('kazeos_backend', format('public.%I', table_name), 'UPDATE') as backend_update,
        has_table_privilege('kazeos_backend', format('public.%I', table_name), 'DELETE') as backend_delete
      from (values
        ('expense_categories'),
        ('recurring_expenses'),
        ('expenses')
      ) as expense_table(table_name)
      order by table_name
    `);

    expect(rows).toEqual([
      {
        authenticated_delete: false,
        authenticated_insert: false,
        authenticated_select: true,
        authenticated_update: false,
        backend_delete: false,
        backend_insert: true,
        backend_update: true,
        table_name: "expense_categories",
      },
      {
        authenticated_delete: false,
        authenticated_insert: false,
        authenticated_select: true,
        authenticated_update: false,
        backend_delete: true,
        backend_insert: true,
        backend_update: true,
        table_name: "expenses",
      },
      {
        authenticated_delete: false,
        authenticated_insert: false,
        authenticated_select: true,
        authenticated_update: false,
        backend_delete: false,
        backend_insert: true,
        backend_update: true,
        table_name: "recurring_expenses",
      },
    ]);
  });

  it("uses a NOLOGIN, non-bypass role that authenticated cannot assume", async () => {
    const [role] = await database!.execute(sql<{
      authenticated_is_backend_member: boolean;
      backend_is_authenticated_member: boolean;
      rolbypassrls: boolean;
      rolcanlogin: boolean;
    }>`
      select
        role_definition.rolcanlogin,
        role_definition.rolbypassrls,
        pg_has_role('kazeos_backend', 'authenticated', 'MEMBER') as backend_is_authenticated_member,
        pg_has_role('authenticated', 'kazeos_backend', 'MEMBER') as authenticated_is_backend_member
      from pg_roles as role_definition
      where role_definition.rolname = 'kazeos_backend'
    `);

    expect(role).toEqual({
      authenticated_is_backend_member: false,
      backend_is_authenticated_member: true,
      rolbypassrls: false,
      rolcanlogin: false,
    });
  });

  it("runs server work as the backend role while preserving owner RLS", async () => {
    await withRollback(async (transaction) => {
      const ownerId = randomUUID();
      const otherOwnerId = randomUUID();
      await transaction.execute(
        sql`insert into auth.users (id) values (${ownerId}), (${otherOwnerId})`,
      );
      const runAsOwner = createAuthenticatedDrizzleRunner(transaction);

      await runAsOwner(ownerId, async (ownerDatabase) => {
        const [context] = await ownerDatabase.execute(sql<{
          current_user: string;
          owner_id: string;
          rls_active: boolean;
        }>`
          select
            current_user,
            auth.uid() as owner_id,
            row_security_active('public.expense_categories'::regclass) as rls_active
        `);
        expect(context).toEqual({
          current_user: "kazeos_backend",
          owner_id: ownerId,
          rls_active: true,
        });

        await ownerDatabase.insert(expenseCategories).values({
          name: `Backend ${randomUUID()}`,
          ownerId,
        });
      });

      await expect(runAsOwner(ownerId, async (ownerDatabase) => {
        await ownerDatabase.insert(expenseCategories).values({
          name: `Foreign ${randomUUID()}`,
          ownerId: otherOwnerId,
        });
      })).rejects.toMatchObject({ cause: { code: "42501" } });
    });
  }, 30_000);

  it("rejects paid expenses without a payment method", async () => {
    const accepted = new Error("DATABASE_ACCEPTED_PAID_WITHOUT_METHOD");
    let result: unknown;

    try {
      await database!.transaction(async (transaction) => {
        const ownerId = randomUUID();
        const categoryId = randomUUID();
        await transaction.execute(sql`insert into auth.users (id) values (${ownerId})`);
        await transaction.insert(expenseCategories).values({
          id: categoryId,
          name: `Paid ${randomUUID()}`,
          ownerId,
        });
        await transaction.execute(sql`
          insert into public.expenses (
            owner_id, title, amount_minor, currency, category_id, scope,
            cost_type, due_date, paid_date, status, payment_method
          ) values (
            ${ownerId}, 'Paid without method', 1000, 'USD', ${categoryId},
            'business', 'fixed', '2026-09-01', '2026-09-01', 'paid', null
          )
        `);
        throw accepted;
      });
    } catch (error) {
      result = error;
    }

    if (result === accepted) {
      throw new Error("Expected paid expense without method to be rejected");
    }
    expect(result).toMatchObject({ cause: { code: "23514" } });
  }, 30_000);
});
