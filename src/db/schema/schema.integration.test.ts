// @vitest-environment node

import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

import { createAuthenticatedDatabaseRunner } from "../authenticated";
import type { DatabaseClient } from "../client";

vi.mock("server-only", () => ({}));

config({ path: ".env.local", quiet: true });

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const sql = databaseUrl
  ? postgres(databaseUrl, { prepare: false, max: 1 })
  : undefined;

type Transaction = postgres.TransactionSql<Record<string, never>>;

const rollback = new Error("ROLLBACK_TEST_TRANSACTION");

async function withRollback(
  operation: (transaction: Transaction) => Promise<void>,
) {
  try {
    await sql!.begin(async (transaction) => {
      await operation(transaction);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) {
      throw error;
    }
  }
}

async function expectDatabaseRejection(
  expectedCode: string,
  operation: (transaction: Transaction) => Promise<void>,
) {
  const accepted = new Error("DATABASE_ACCEPTED_INVALID_ROW");
  let result: unknown;

  try {
    await sql!.begin(async (transaction) => {
      await operation(transaction);
      throw accepted;
    });
  } catch (error) {
    result = error;
  }

  if (result === accepted) {
    throw new Error("Expected the database to reject the invalid operation");
  }

  expect(result).toMatchObject({ code: expectedCode });
}

async function createOwnerAndClients(transaction: Transaction) {
  const ownerId = randomUUID();
  const firstClientId = randomUUID();
  const secondClientId = randomUUID();

  await transaction`insert into auth.users (id) values (${ownerId})`;
  await transaction`
    insert into public.clients (id, owner_id, first_name)
    values
      (${firstClientId}, ${ownerId}, 'First'),
      (${secondClientId}, ${ownerId}, 'Second')
  `;

  return { ownerId, firstClientId, secondClientId };
}

async function createExpenseOwners(transaction: Transaction) {
  const firstOwnerId = randomUUID();
  const secondOwnerId = randomUUID();

  await transaction`
    insert into auth.users (id)
    values (${firstOwnerId}), (${secondOwnerId})
  `;

  return { firstOwnerId, secondOwnerId };
}

async function createService(
  transaction: Transaction,
  ownerId: string,
  clientId: string,
) {
  const serviceId = randomUUID();

  await transaction`
    insert into public.services (
      id, owner_id, client_id, name, billing_type, amount_minor, currency,
      billing_frequency, billing_day, start_date
    ) values (
      ${serviceId}, ${ownerId}, ${clientId}, 'Service', 'recurring', 10000,
      'USD', 'monthly', 1, '2026-08-01'
    )
  `;

  return serviceId;
}

async function createCharge(
  transaction: Transaction,
  ownerId: string,
  clientId: string,
  currency: "USD" | "ARS" = "USD",
) {
  const chargeId = randomUUID();

  await transaction`
    insert into public.charges (
      id, owner_id, client_id, description, amount_minor, currency, due_date
    ) values (
      ${chargeId}, ${ownerId}, ${clientId}, 'Charge', 10000, ${currency},
      '2026-09-01'
    )
  `;

  return chargeId;
}

afterAll(async () => {
  await sql?.end();
});

describeDatabase("remote database integrity", () => {
  it("uses authenticated claims and an RLS-active role on the application path", async () => {
    const userId = randomUUID();
    const withAuthenticatedDatabase = createAuthenticatedDatabaseRunner(
      sql! as unknown as Pick<DatabaseClient, "begin">,
      (transaction) => transaction,
    );

    await withAuthenticatedDatabase(userId, async (transaction) => {
      const [context] = await transaction`
        select
          current_user,
          auth.uid() as user_id,
          row_security_active('public.clients'::regclass) as rls_active
      `;

      expect(context).toMatchObject({
        current_user: "authenticated",
        user_id: userId,
        rls_active: true,
      });
    });
  });

  it("exposes only command-specific authenticated policies and ACLs", async () => {
    const appTables = [
      "profiles",
      "clients",
      "services",
      "charges",
      "payments",
      "tasks",
      "client_notes",
      "settings",
      "expense_categories",
      "recurring_expenses",
      "expenses",
    ];
    const policies = await sql!`
      select tablename, cmd, roles, qual, with_check
      from pg_policies
      where schemaname = 'public'
        and tablename = any(${appTables})
      order by tablename, cmd
    `;

    expect(policies).toHaveLength(36);
    expect(policies.every((policy) => policy.roles.includes("authenticated"))).toBe(
      true,
    );
    expect(policies.some((policy) => policy.cmd === "ALL")).toBe(false);
    expect(
      policies
        .filter((policy) => policy.cmd === "DELETE")
        .map((policy) => policy.tablename)
        .sort(),
    ).toEqual(["client_notes", "expenses", "tasks"]);
    expect(
      policies.every((policy) =>
        `${policy.qual ?? ""} ${policy.with_check ?? ""}`.includes("auth.uid()"),
      ),
    ).toBe(true);

    const privileges = await sql!`
      select
        table_name,
        has_table_privilege('anon', format('public.%I', table_name), 'SELECT') as anon_select,
        has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE') as authenticated_delete
      from unnest(${appTables}::text[]) as app_table(table_name)
      order by table_name
    `;

    expect(privileges.every((privilege) => !privilege.anon_select)).toBe(true);
    expect(
      privileges
        .filter((privilege) => privilege.authenticated_delete)
        .map((privilege) => privilege.table_name),
    ).toEqual(["client_notes", "expenses", "tasks"]);
  });

  it("has one authoritative migration history and indexed foreign keys", async () => {
    const migrations = await sql!`
      select version
      from supabase_migrations.schema_migrations
      where version in ('20260831031346', '20260831040110', '20260831191020')
      order by version
    `;
    expect(migrations.map((migration) => migration.version)).toEqual([
      "20260831031346",
      "20260831040110",
      "20260831191020",
    ]);

    const missingIndexes = await sql!`
      select constraint_definition.conname
      from pg_constraint as constraint_definition
      join pg_class as table_definition
        on table_definition.oid = constraint_definition.conrelid
      join pg_namespace as table_namespace
        on table_namespace.oid = table_definition.relnamespace
      where constraint_definition.contype = 'f'
        and table_namespace.nspname = 'public'
        and table_definition.relname = any(${[
          "profiles",
          "clients",
          "services",
          "charges",
          "payments",
          "tasks",
          "client_notes",
          "settings",
          "expense_categories",
          "recurring_expenses",
          "expenses",
        ]})
        and not exists (
          select 1
          from pg_index as index_definition
          where index_definition.indrelid = constraint_definition.conrelid
            and index_definition.indisvalid
            and array(
              select index_attribute
              from unnest(index_definition.indkey::smallint[]) as index_attribute
              limit cardinality(constraint_definition.conkey)
            ) = constraint_definition.conkey
        )
    `;
    expect(missingIndexes).toEqual([]);
  });

  it("installs only fixed-search-path private helpers and all audit triggers", async () => {
    const functions = await sql!`
      select procedure.proname, procedure.prosecdef, procedure.proconfig
      from pg_proc as procedure
      join pg_namespace as function_namespace
        on function_namespace.oid = procedure.pronamespace
      where function_namespace.nspname = 'private'
        and procedure.proname = any(${[
          "guard_charge_payment_totals",
          "recompute_charge_payment_totals",
          "sync_charge_from_payments",
          "set_updated_at",
        ]})
      order by procedure.proname
    `;
    expect(functions).toHaveLength(4);
    expect(
      functions.every((procedure) =>
        procedure.proconfig?.some((entry: string) => entry.startsWith("search_path=")),
      ),
    ).toBe(true);
    expect(
      functions
        .filter((procedure) => procedure.prosecdef)
        .map((procedure) => procedure.proname),
    ).toEqual([
      "recompute_charge_payment_totals",
      "sync_charge_from_payments",
    ]);

    const triggers = await sql!`
      select trigger.tgname, table_definition.relname
      from pg_trigger as trigger
      join pg_class as table_definition
        on table_definition.oid = trigger.tgrelid
      join pg_namespace as table_namespace
        on table_namespace.oid = table_definition.relnamespace
      where table_namespace.nspname = 'public'
        and not trigger.tgisinternal
        and (
          trigger.tgname like '%_set_updated_at'
          or trigger.tgname in (
            'charges_guard_payment_totals',
            'payments_sync_charge_totals'
          )
        )
      order by trigger.tgname
    `;
    expect(triggers).toHaveLength(10);
    expect(
      triggers.filter((trigger) => trigger.tgname.endsWith("_set_updated_at")),
    ).toHaveLength(8);
  });

  it("rejects a charge whose service belongs to another client", async () => {
    await expectDatabaseRejection("23503", async (transaction) => {
      const { ownerId, firstClientId, secondClientId } =
        await createOwnerAndClients(transaction);
      const serviceId = await createService(transaction, ownerId, firstClientId);

      await transaction`
        insert into public.charges (
          owner_id, client_id, service_id, description, amount_minor, currency,
          due_date
        ) values (
          ${ownerId}, ${secondClientId}, ${serviceId}, 'Invalid charge', 10000,
          'USD', '2026-09-01'
        )
      `;
    });
  });

  it("rejects an expense whose category belongs to another owner", async () => {
    await expectDatabaseRejection("23503", async (transaction) => {
      const { firstOwnerId, secondOwnerId } =
        await createExpenseOwners(transaction);
      const categoryId = randomUUID();

      await transaction`
        insert into public.expense_categories (id, owner_id, name)
        values (${categoryId}, ${firstOwnerId}, 'Owner A category')
      `;
      await transaction`
        insert into public.expenses (
          owner_id, title, amount_minor, currency, category_id, scope,
          cost_type, due_date
        ) values (
          ${secondOwnerId}, 'Cross-owner expense', 1000, 'USD', ${categoryId},
          'business', 'fixed', '2026-09-02'
        )
      `;
    });
  });

  it("rejects an expense whose recurrence belongs to another owner", async () => {
    await expectDatabaseRejection("23503", async (transaction) => {
      const { firstOwnerId, secondOwnerId } =
        await createExpenseOwners(transaction);
      const firstCategoryId = randomUUID();
      const secondCategoryId = randomUUID();
      const recurringExpenseId = randomUUID();

      await transaction`
        insert into public.expense_categories (id, owner_id, name)
        values
          (${firstCategoryId}, ${firstOwnerId}, 'Owner A category'),
          (${secondCategoryId}, ${secondOwnerId}, 'Owner B category')
      `;
      await transaction`
        insert into public.recurring_expenses (
          id, owner_id, title, amount_minor, currency, category_id, scope,
          cost_type, frequency, billing_day, start_date
        ) values (
          ${recurringExpenseId}, ${firstOwnerId}, 'Owner A recurrence', 1000,
          'USD', ${firstCategoryId}, 'business', 'fixed', 'monthly', 1,
          '2026-09-01'
        )
      `;
      await transaction`
        insert into public.expenses (
          owner_id, title, amount_minor, currency, category_id, scope,
          cost_type, recurring_expense_id, period_key, due_date,
          generated_automatically
        ) values (
          ${secondOwnerId}, 'Cross-owner recurrence', 1000, 'USD',
          ${secondCategoryId}, 'business', 'fixed', ${recurringExpenseId},
          '2026-09', '2026-09-02', true
        )
      `;
    });
  });

  it("hides every expense-domain row from another authenticated owner", async () => {
    await withRollback(async (transaction) => {
      const { firstOwnerId, secondOwnerId } =
        await createExpenseOwners(transaction);
      const firstCategoryId = randomUUID();
      const secondCategoryId = randomUUID();
      const firstRecurringId = randomUUID();
      const secondRecurringId = randomUUID();
      const firstExpenseId = randomUUID();
      const secondExpenseId = randomUUID();

      await transaction`
        insert into public.expense_categories (id, owner_id, name)
        values
          (${firstCategoryId}, ${firstOwnerId}, 'Owner A category'),
          (${secondCategoryId}, ${secondOwnerId}, 'Owner B category')
      `;
      await transaction`
        insert into public.recurring_expenses (
          id, owner_id, title, amount_minor, currency, category_id, scope,
          cost_type, frequency, billing_day, start_date
        ) values
          (${firstRecurringId}, ${firstOwnerId}, 'Owner A recurrence', 1000,
           'USD', ${firstCategoryId}, 'business', 'fixed', 'monthly', 1,
           '2026-09-01'),
          (${secondRecurringId}, ${secondOwnerId}, 'Owner B recurrence', 1000,
           'USD', ${secondCategoryId}, 'business', 'fixed', 'monthly', 1,
           '2026-09-01')
      `;
      await transaction`
        insert into public.expenses (
          id, owner_id, title, amount_minor, currency, category_id, scope,
          cost_type, due_date
        ) values
          (${firstExpenseId}, ${firstOwnerId}, 'Owner A expense', 1000, 'USD',
           ${firstCategoryId}, 'business', 'fixed', '2026-09-02'),
          (${secondExpenseId}, ${secondOwnerId}, 'Owner B expense', 1000, 'USD',
           ${secondCategoryId}, 'business', 'fixed', '2026-09-02')
      `;

      await transaction`
        select set_config(
          'request.jwt.claims',
          ${JSON.stringify({ sub: secondOwnerId, role: "authenticated" })},
          true
        )
      `;
      await transaction.unsafe("set local role authenticated");

      const categories = await transaction`
        select id from public.expense_categories order by id
      `;
      const recurring = await transaction`
        select id from public.recurring_expenses order by id
      `;
      const expenses = await transaction`
        select id from public.expenses order by id
      `;

      expect(categories.map((row) => row.id)).toEqual([secondCategoryId]);
      expect(recurring.map((row) => row.id)).toEqual([secondRecurringId]);
      expect(expenses.map((row) => row.id)).toEqual([secondExpenseId]);
    });
  });

  it("deletes only manual unpaid expenses and retains financial history", async () => {
    await withRollback(async (transaction) => {
      const { firstOwnerId } = await createExpenseOwners(transaction);
      const categoryId = randomUUID();
      const recurringExpenseId = randomUUID();
      const manualPendingId = randomUUID();
      const paidExpenseId = randomUUID();
      const generatedExpenseId = randomUUID();

      await transaction`
        insert into public.expense_categories (id, owner_id, name)
        values (${categoryId}, ${firstOwnerId}, 'Retained history category')
      `;
      await transaction`
        insert into public.recurring_expenses (
          id, owner_id, title, amount_minor, currency, category_id, scope,
          cost_type, frequency, billing_day, start_date
        ) values (
          ${recurringExpenseId}, ${firstOwnerId}, 'Retained recurrence', 1000,
          'USD', ${categoryId}, 'business', 'fixed', 'monthly', 1,
          '2026-09-01'
        )
      `;
      await transaction`
        insert into public.expenses (
          id, owner_id, title, amount_minor, currency, category_id, scope,
          cost_type, recurring_expense_id, period_key, due_date, paid_date,
          status, generated_automatically
        ) values
          (${manualPendingId}, ${firstOwnerId}, 'Manual pending', 1000, 'USD',
           ${categoryId}, 'business', 'fixed', null, null, '2026-09-02', null,
           'pending', false),
          (${paidExpenseId}, ${firstOwnerId}, 'Paid history', 1000, 'USD',
           ${categoryId}, 'business', 'fixed', null, null, '2026-09-01',
           '2026-09-01', 'paid', false),
          (${generatedExpenseId}, ${firstOwnerId}, 'Generated history', 1000,
           'USD', ${categoryId}, 'business', 'fixed', ${recurringExpenseId},
           '2026-09', '2026-09-02', null, 'pending', true)
      `;

      await transaction`
        select set_config(
          'request.jwt.claims',
          ${JSON.stringify({ sub: firstOwnerId, role: "authenticated" })},
          true
        )
      `;
      await transaction.unsafe("set local role authenticated");

      const deleted = await transaction`
        delete from public.expenses
        where id = any(${[
          manualPendingId,
          paidExpenseId,
          generatedExpenseId,
        ]}::uuid[])
        returning id
      `;
      const retained = await transaction`
        select id
        from public.expenses
        where id = any(${[paidExpenseId, generatedExpenseId]}::uuid[])
        order by id
      `;

      expect(deleted.map((row) => row.id)).toEqual([manualPendingId]);
      expect(retained.map((row) => row.id).sort()).toEqual(
        [paidExpenseId, generatedExpenseId].sort(),
      );
    });
  });

  it.each([
    ["client", "USD"],
    ["currency", "ARS"],
  ] as const)(
    "rejects a payment with mismatched charge %s",
    async (mismatch, paymentCurrency) => {
      await expectDatabaseRejection("23503", async (transaction) => {
        const { ownerId, firstClientId, secondClientId } =
          await createOwnerAndClients(transaction);
        const chargeId = await createCharge(
          transaction,
          ownerId,
          firstClientId,
        );

        await transaction`
          insert into public.payments (
            owner_id, client_id, charge_id, amount_minor, currency,
            payment_date, payment_method
          ) values (
            ${ownerId},
            ${mismatch === "client" ? secondClientId : firstClientId},
            ${chargeId}, 1000, ${paymentCurrency}, '2026-08-31', 'cash'
          )
        `;
      });
    },
  );

  it("keeps partial, full, and overpayment totals synchronized", async () => {
    await withRollback(async (transaction) => {
      const { ownerId, firstClientId } =
        await createOwnerAndClients(transaction);
      const chargeId = await createCharge(transaction, ownerId, firstClientId);

      for (const [amount, expectedPaid, expectedStatus] of [
        [4000, 4000, "partial"],
        [6000, 10000, "paid"],
        [2500, 12500, "paid"],
      ] as const) {
        await transaction`
          insert into public.payments (
            owner_id, client_id, charge_id, amount_minor, currency,
            payment_date, payment_method
          ) values (
            ${ownerId}, ${firstClientId}, ${chargeId}, ${amount}, 'USD',
            '2026-08-31', 'cash'
          )
        `;
        const [charge] = await transaction`
          select amount_paid_minor, status
          from public.charges
          where id = ${chargeId}
        `;

        expect(Number(charge.amount_paid_minor)).toBe(expectedPaid);
        expect(charge.status).toBe(expectedStatus);
      }
    });
  });

  it("recomputes charge totals after payment updates and deletes", async () => {
    await withRollback(async (transaction) => {
      const { ownerId, firstClientId } =
        await createOwnerAndClients(transaction);
      const chargeId = await createCharge(transaction, ownerId, firstClientId);
      const paymentId = randomUUID();

      await transaction`
        insert into public.payments (
          id, owner_id, client_id, charge_id, amount_minor, currency,
          payment_date, payment_method
        ) values (
          ${paymentId}, ${ownerId}, ${firstClientId}, ${chargeId}, 4000, 'USD',
          '2026-08-31', 'cash'
        )
      `;
      await transaction`
        update public.payments set amount_minor = 10000 where id = ${paymentId}
      `;

      const [paidCharge] = await transaction`
        select amount_paid_minor, status from public.charges where id = ${chargeId}
      `;
      expect(Number(paidCharge.amount_paid_minor)).toBe(10000);
      expect(paidCharge.status).toBe("paid");

      await transaction`delete from public.payments where id = ${paymentId}`;
      const [pendingCharge] = await transaction`
        select amount_paid_minor, status from public.charges where id = ${chargeId}
      `;
      expect(Number(pendingCharge.amount_paid_minor)).toBe(0);
      expect(pendingCharge.status).toBe("pending");
    });
  });

  it("rejects a direct charge total that disagrees with payments", async () => {
    await expectDatabaseRejection("23514", async (transaction) => {
      const { ownerId, firstClientId } =
        await createOwnerAndClients(transaction);
      const chargeId = await createCharge(transaction, ownerId, firstClientId);

      await transaction`
        update public.charges
        set amount_paid_minor = 1000, status = 'partial'
        where id = ${chargeId}
      `;
    });
  });

  it("allows an unallocated payment", async () => {
    await withRollback(async (transaction) => {
      const { ownerId, firstClientId } =
        await createOwnerAndClients(transaction);

      await transaction`
        insert into public.payments (
          owner_id, client_id, charge_id, amount_minor, currency,
          payment_date, payment_method
        ) values (
          ${ownerId}, ${firstClientId}, null, 1000, 'ARS', '2026-08-31', 'cash'
        )
      `;
    });
  });

  it("rejects a recurrence child without a recurrence key", async () => {
    await expectDatabaseRejection("23514", async (transaction) => {
      const { ownerId } = await createOwnerAndClients(transaction);
      const parentId = randomUUID();

      await transaction`
        insert into public.tasks (
          id, owner_id, title, recurring, recurrence
        ) values (${parentId}, ${ownerId}, 'Recurring', true, 'monthly')
      `;
      await transaction`
        insert into public.tasks (
          owner_id, title, recurring, parent_id, recurrence_key
        ) values (${ownerId}, 'Occurrence', false, ${parentId}, null)
      `;
    });
  });

  it("automatically advances updated_at on mutable rows", async () => {
    await withRollback(async (transaction) => {
      const { firstClientId } = await createOwnerAndClients(transaction);

      await transaction`
        update public.clients
        set updated_at = '2000-01-01T00:00:00Z', first_name = 'Updated'
        where id = ${firstClientId}
      `;
      const [client] = await transaction`
        select updated_at
        from public.clients
        where id = ${firstClientId}
      `;

      expect(new Date(client.updated_at).getUTCFullYear()).toBeGreaterThan(2000);
    });
  });

  it("denies authenticated deletion of retained financial history", async () => {
    await expectDatabaseRejection("42501", async (transaction) => {
      const { ownerId, firstClientId } =
        await createOwnerAndClients(transaction);
      const chargeId = await createCharge(transaction, ownerId, firstClientId);

      await transaction`
        select set_config(
          'request.jwt.claims',
          ${JSON.stringify({ sub: ownerId, role: "authenticated" })},
          true
        )
      `;
      await transaction.unsafe("set local role authenticated");
      await transaction`delete from public.charges where id = ${chargeId}`;
    });
  });

  it("stores the Argentina-local commercial date default explicitly", async () => {
    const [column] = await sql!.unsafe(
      `select column_default
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'clients'
         and column_name = 'joined_at'`,
    );

    expect(column.column_default.toLowerCase()).toContain(
      "america/argentina/buenos_aires",
    );
  });
});
