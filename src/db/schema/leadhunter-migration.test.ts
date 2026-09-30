// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0009_add_leadhunter.sql"),
  "utf8",
)
  .toLowerCase()
  .replaceAll('"', "")
  .replace(/\s+/g, " ");

const tables = [
  "lh_campaigns",
  "lh_campaign_versions",
  "lh_leads",
  "lh_contacts",
  "lh_evidence",
  "lh_enrollments",
  "lh_activity",
];

describe("LeadHunter migration", () => {
  it("keeps writes behind the backend role", () => {
    for (const table of tables) {
      expect(migration).toContain(`public.${table}`);
    }
    expect(migration).toMatch(
      /revoke all on table public\.lh_campaigns,[^;]+ from public, anon, authenticated/,
    );
    expect(migration).toMatch(
      /grant select on table public\.lh_campaigns,[^;]+ to authenticated/,
    );
    expect(migration).toMatch(
      /grant select, insert, update on table public\.lh_campaigns,[^;]+ to kazeos_backend/,
    );
  });

  it("maintains updated_at on mutable tables", () => {
    for (const table of [
      "lh_campaigns",
      "lh_leads",
      "lh_contacts",
      "lh_evidence",
      "lh_enrollments",
    ]) {
      expect(migration).toContain(`create trigger ${table}_set_updated_at`);
      expect(migration).toContain(`before update on public.${table}`);
      expect(migration).toContain("execute function private.set_updated_at()");
    }
  });

  it("is forward-only", () => {
    expect(migration).not.toMatch(/drop\s+(?:table|type)|truncate/);
  });
});
