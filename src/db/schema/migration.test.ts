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
