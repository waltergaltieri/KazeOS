// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationDirectory = resolve(process.cwd(), "supabase/migrations");
const hardeningMigration = readdirSync(migrationDirectory).find((name) =>
  name.endsWith("_harden_schema_integrity.sql"),
);
const settingsLocaleMigration = readdirSync(migrationDirectory).find((name) =>
  name.endsWith("_add_settings_locale.sql"),
);
const expenseMigration = readdirSync(migrationDirectory).find((name) =>
  name.endsWith("_add_expenses.sql"),
);
const expenseHistoryProtectionMigration = readdirSync(migrationDirectory).find(
  (name) => name.endsWith("_protect_expense_history.sql"),
);

describe("expense schema migration", () => {
  it("is a Drizzle-named forward-only migration", () => {
    expect(expenseMigration).toMatch(/^\d{14}_add_expenses\.sql$/);

    const sql = readFileSync(
      resolve(migrationDirectory, expenseMigration!),
      "utf8",
    ).toLowerCase();

    expect(sql).toContain('create table "expense_categories"');
    expect(sql).toContain('create table "recurring_expenses"');
    expect(sql).toContain('create table "expenses"');
    expect(sql).toContain("expenses_recurring_period_unique");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("debit_card");
    expect(sql).toContain("credit_card");
    expect(sql).not.toMatch(/drop\s+(?:table|type)|truncate/);
    expect(sql).not.toMatch(
      /(?:alter|create|drop|truncate)\s+table\s+(?:"?auth"?\.)/,
    );
  });

  it("installs owner-scoped constraints and command-specific policies", () => {
    expect(expenseMigration).toBeDefined();
    const sql = readFileSync(
      resolve(migrationDirectory, expenseMigration!),
      "utf8",
    ).toLowerCase();
    const normalizedSql = sql.replaceAll('"', "").replace(/\s+/g, " ");

    expect(normalizedSql).toContain(
      "foreign key (owner_id,category_id) references public.expense_categories(owner_id,id)",
    );
    expect(normalizedSql).toContain(
      "foreign key (recurring_expense_id,owner_id) references public.recurring_expenses(id,owner_id)",
    );
    expect(normalizedSql).not.toContain("for all to authenticated");

    for (const table of [
      "expense_categories",
      "recurring_expenses",
      "expenses",
    ]) {
      expect(normalizedSql).toContain(
        `create policy ${table}_authenticated_select on ${table}`,
      );
      expect(normalizedSql).toContain(
        `create policy ${table}_authenticated_insert on ${table}`,
      );
      expect(normalizedSql).toContain(
        `create policy ${table}_authenticated_update on ${table}`,
      );
    }

    expect(normalizedSql).not.toContain(
      "create policy expense_categories_authenticated_delete",
    );
    expect(normalizedSql).not.toContain(
      "create policy recurring_expenses_authenticated_delete",
    );
    expect(normalizedSql).toContain(
      "create policy expenses_authenticated_delete",
    );
    expect(normalizedSql).toContain("recurring_expense_id is null");
    expect(normalizedSql).toContain("generated_automatically = false");
    expect(normalizedSql).toContain("status in ('planned', 'pending')");
  });

  it("revokes defaults and grants only the required authenticated operations", () => {
    expect(expenseMigration).toBeDefined();
    const sql = readFileSync(
      resolve(migrationDirectory, expenseMigration!),
      "utf8",
    ).toLowerCase();
    const normalizedSql = sql.replaceAll('"', "").replace(/\s+/g, " ");

    expect(normalizedSql).toContain(
      "revoke all on table public.expense_categories, public.recurring_expenses, public.expenses from public, anon, authenticated",
    );
    expect(normalizedSql).toContain(
      "grant select, insert, update on table public.expense_categories, public.recurring_expenses to authenticated",
    );
    expect(normalizedSql).toContain(
      "grant select, insert, update, delete on table public.expenses to authenticated",
    );
  });
});

describe("expense history protection migration", () => {
  it("is a separate forward-only migration", () => {
    expect(expenseHistoryProtectionMigration).toMatch(
      /^\d{14}_protect_expense_history\.sql$/,
    );

    const sql = readFileSync(
      resolve(migrationDirectory, expenseHistoryProtectionMigration!),
      "utf8",
    ).toLowerCase();

    expect(sql).toContain(
      "create or replace function private.guard_expense_history()",
    );
    expect(sql).toContain("old.status = 'paid'");
    expect(sql).toContain("new.status <> 'paid'");
    expect(sql).toContain("old.status = 'cancelled'");
    expect(sql).toContain("new.status <> 'cancelled'");
    expect(sql).toContain(
      "new.generated_automatically is distinct from old.generated_automatically",
    );
    expect(sql).toContain(
      "new.recurring_expense_id is distinct from old.recurring_expense_id",
    );
    expect(sql).toContain("new.period_key is distinct from old.period_key");
    expect(sql).toContain("before update on public.expenses");

    for (const table of [
      "expense_categories",
      "recurring_expenses",
      "expenses",
    ]) {
      expect(sql).toContain(`create trigger ${table}_set_updated_at`);
      expect(sql).toContain(`before update on public.${table}`);
      expect(sql).toContain("execute function private.set_updated_at()");
    }

    expect(sql).not.toMatch(/drop\s+(?:table|type)|truncate/);
    expect(sql).not.toMatch(
      /(?:alter|create|drop|truncate)\s+table\s+(?:"?auth"?\.)/,
    );
  });
});

describe("schema hardening migration", () => {
  it("adds locale in a separate CLI-named forward-only migration", () => {
    expect(settingsLocaleMigration).toMatch(/^\d{14}_add_settings_locale\.sql$/);
    const sql = readFileSync(resolve(migrationDirectory, settingsLocaleMigration!), "utf8").toLowerCase().replace(/\s+/g, " ");
    expect(sql).toContain("alter table public.settings add column locale text not null default 'es-ar'");
    expect(sql).toContain("constraint settings_locale_not_blank");
    expect(sql).not.toMatch(/create\s+(?:schema|table)|grant|policy/);
  });
  it("is a separate forward-only Supabase migration", () => {
    expect(hardeningMigration).toMatch(/^\d{14}_harden_schema_integrity\.sql$/);
  });

  it("contains private financial and timestamp trigger functions", () => {
    expect(hardeningMigration).toBeDefined();
    const sql = readFileSync(
      resolve(migrationDirectory, hardeningMigration!),
      "utf8",
    ).toLowerCase();

    expect(sql).toContain("create schema if not exists private");
    expect(sql).toContain("security definer");
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain("recompute_charge_payment_totals");
    expect(sql).toContain("guard_charge_payment_totals");
    expect(sql).toContain("set_updated_at");
    expect(sql).toContain("after insert or update or delete on public.payments");
    expect(sql.match(/before update on public\./g)?.length).toBe(8);
  });

  it("removes broad policies and direct retained-record deletion", () => {
    expect(hardeningMigration).toBeDefined();
    const sql = readFileSync(
      resolve(migrationDirectory, hardeningMigration!),
      "utf8",
    ).toLowerCase();
    const normalizedSql = sql.replaceAll('"', "");

    expect(normalizedSql).not.toContain("for all to authenticated");
    expect(normalizedSql).toContain("for select to authenticated");
    expect(normalizedSql).toContain("for insert to authenticated");
    expect(normalizedSql).toContain("for update to authenticated");
    expect(normalizedSql).toContain("for delete to authenticated");
    expect(sql).toContain("revoke all on table");
    const deleteGrants = (sql.match(/grant[\s\S]*?;/g) ?? []).filter((statement) =>
      statement.includes("delete"),
    );
    for (const retainedTable of [
      "profiles",
      "clients",
      "services",
      "charges",
      "payments",
      "settings",
    ]) {
      expect(deleteGrants.join("\n")).not.toContain(retainedTable);
    }
  });

  it("adds exact cross-client and financial constraints", () => {
    expect(hardeningMigration).toBeDefined();
    const sql = readFileSync(
      resolve(migrationDirectory, hardeningMigration!),
      "utf8",
    ).toLowerCase();
    const normalizedSql = sql
      .replaceAll('"', "")
      .replace(/\s+/g, " ")
      .replace(/,\s*/g, ",");

    expect(normalizedSql).toContain(
      "foreign key (service_id,owner_id,client_id) references public.services(id,owner_id,client_id)",
    );
    expect(normalizedSql).toContain(
      "foreign key (charge_id,owner_id,client_id,currency) references public.charges(id,owner_id,client_id,currency)",
    );
    expect(sql).toContain("9007199254740991");
    expect(normalizedSql).toContain("recurrence_key is not null");
    expect(sql).toContain(
      "now() at time zone 'america/argentina/buenos_aires'",
    );
  });
});
