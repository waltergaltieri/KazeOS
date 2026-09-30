// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

function normalizeSql(value: string) {
  return value.toLowerCase().replaceAll('"', "").replace(/\s+/g, " ");
}

const foundationMigration = normalizeSql(readFileSync(
  resolve(process.cwd(), "supabase/migrations/0009_add_leadhunter.sql"),
  "utf8",
));
const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/0010_add_leadhunter_pipeline.sql",
);
const snapshotPath = resolve(
  process.cwd(),
  "supabase/migrations/meta/0010_snapshot.json",
);
const journalPath = resolve(
  process.cwd(),
  "supabase/migrations/meta/_journal.json",
);
const migration = existsSync(migrationPath)
  ? normalizeSql(readFileSync(migrationPath, "utf8"))
  : "";
const outboxGuard = migration.match(
  /create or replace function private\.guard_lh_outbox_command\(\)(.*?)\$\$;/,
)?.[1] ?? "";
const messageBriefDefinition =
  migration
    .split("create table lh_message_briefs (")[1]
    ?.split("alter table lh_message_briefs enable row level security")[0] ?? "";

const foundationTables = [
  "lh_campaigns",
  "lh_campaign_versions",
  "lh_leads",
  "lh_contacts",
  "lh_evidence",
  "lh_enrollments",
  "lh_activity",
];

const pipelineTables = [
  "lh_runs",
  "lh_jobs",
  "lh_source_candidates",
  "lh_website_audits",
  "lh_message_briefs",
  "lh_message_versions",
  "lh_outbox",
];
const mutablePipelineTables = pipelineTables.filter(
  (table) => table !== "lh_message_briefs",
);

describe("LeadHunter foundation migration", () => {
  it("keeps foundation writes behind the backend role", () => {
    for (const table of foundationTables) {
      expect(foundationMigration).toContain(`public.${table}`);
    }
    expect(foundationMigration).toMatch(
      /revoke all on table public\.lh_campaigns,[^;]+ from public, anon, authenticated/,
    );
    expect(foundationMigration).toMatch(
      /grant select on table public\.lh_campaigns,[^;]+ to authenticated/,
    );
    expect(foundationMigration).toMatch(
      /grant select, insert, update on table public\.lh_campaigns,[^;]+ to kazeos_backend/,
    );
  });

  it("maintains updated_at on mutable foundation tables", () => {
    for (const table of [
      "lh_campaigns",
      "lh_leads",
      "lh_contacts",
      "lh_evidence",
      "lh_enrollments",
    ]) {
      expect(foundationMigration).toContain(`create trigger ${table}_set_updated_at`);
      expect(foundationMigration).toContain(`before update on public.${table}`);
      expect(foundationMigration).toContain("execute function private.set_updated_at()");
    }
  });

  it("is forward-only", () => {
    expect(foundationMigration).not.toMatch(/drop\s+(?:table|type)|truncate/);
  });
});

describe("LeadHunter pipeline migration", () => {
  it("creates every durable pipeline table and enum", () => {
    for (const table of pipelineTables) {
      expect(migration).toContain(`create table ${table}`);
      expect(migration).toContain(`alter table ${table} enable row level security`);
    }

    expect(migration).toContain("create type public.lh_run_state as enum('planned', 'running', 'completed', 'partial', 'failed', 'cancelled')");
    expect(migration).toContain("create type public.lh_job_state as enum('queued', 'leased', 'succeeded', 'failed', 'cancelled')");
    expect(migration).toContain("create type public.lh_job_kind as enum('discover', 'resolve_identity', 'research', 'audit_website', 'qualify', 'enrich_contact', 'prepare_message', 'validate_message')");
    expect(migration).toContain("create type public.lh_message_state as enum('draft', 'valid', 'invalid', 'superseded')");
    expect(migration).toContain("create type public.lh_outbox_state as enum('queued', 'leased', 'provider_accepted', 'failed', 'unknown', 'cancelled')");
  });

  it("extends existing prospect records with provenance and message links", () => {
    expect(migration).toContain("alter table lh_contacts add column email_confidence smallint");
    expect(migration).toContain("alter table lh_contacts add column source_type text");
    expect(migration).toContain("alter table lh_contacts add column is_primary boolean default false not null");
    expect(migration).toContain("alter table lh_contacts add column verified_at timestamp with time zone");
    expect(migration).toContain("alter table lh_enrollments add column qualification_detail jsonb");
    expect(migration).toContain("alter table lh_enrollments add column research_summary jsonb");
    expect(migration).toContain("alter table lh_enrollments add column message_version_id uuid");
    expect(migration).toContain("alter table lh_evidence add column run_id uuid");
    expect(migration).toContain("alter table lh_evidence add column campaign_id uuid");
    expect(migration).toContain("alter table lh_evidence add column extract text");
    expect(migration).toContain("alter table lh_evidence add column content_hash text");
  });

  it("adds owner-scoped foreign keys, idempotency constraints and queue indexes", () => {
    expect(migration).toContain(
      "constraint lh_jobs_owner_idempotency_key_unique unique(owner_id,idempotency_key)",
    );
    expect(migration).toContain(
      "constraint lh_outbox_owner_idempotency_key_unique unique(owner_id,idempotency_key)",
    );
    expect(migration).toContain(
      "constraint lh_outbox_enrollment_logical_step_unique unique(owner_id,enrollment_id,logical_step)",
    );
    expect(migration).toContain(
      "foreign key (owner_id,run_id) references public.lh_runs(owner_id,id)",
    );
    expect(migration).toContain(
      "foreign key (owner_id,enrollment_id) references public.lh_enrollments(owner_id,id)",
    );
    expect(migration).toContain(
      "foreign key (owner_id,lead_id) references public.lh_leads(owner_id,id)",
    );
    expect(migration).toContain(
      "constraint lh_enrollments_owner_message_version_message_versions_owner_id_id_enrollment_id_fk foreign key (owner_id,message_version_id,id) references public.lh_message_versions(owner_id,id,enrollment_id)",
    );
    expect(migration).toContain("create index lh_jobs_claimable_idx");
    expect(migration).toContain("where lh_jobs.state in ('queued', 'leased')");
    expect(migration).toContain("create index lh_outbox_due_idx");
    expect(migration).toContain("where lh_outbox.state = 'queued'");
  });

  it("keeps every pipeline write behind the backend role", () => {
    expect(migration).toMatch(
      /revoke all on table public\.lh_runs,[^;]+ from public, anon, authenticated/,
    );
    expect(migration).toMatch(
      /grant select on table public\.lh_runs,[^;]+ to authenticated/,
    );
    expect(migration).toMatch(
      /grant select, insert, update on table public\.lh_runs,[^;]+ to kazeos_backend/,
    );
    expect(migration).toContain(
      "grant select, insert on table public.lh_message_briefs to kazeos_backend",
    );

    for (const table of pipelineTables) {
      expect(migration).toContain(`create policy ${table}_authenticated_select`);
      expect(migration).toContain(`create policy ${table}_backend_insert`);
      expect(migration).not.toContain(`create policy ${table}_authenticated_insert`);
      expect(migration).not.toContain(`create policy ${table}_authenticated_update`);
    }
    for (const table of mutablePipelineTables) {
      expect(migration).toContain(`create policy ${table}_backend_update`);
    }
    expect(migration).not.toContain("create policy lh_message_briefs_backend_update");
  });

  it("maintains updated_at on mutable pipeline tables", () => {
    for (const table of mutablePipelineTables) {
      expect(migration).toContain(`create trigger ${table}_set_updated_at`);
      expect(migration).toContain(`before update on public.${table}`);
      expect(migration).toContain("execute function private.set_updated_at()");
    }
  });

  it("keeps message briefs immutable after insertion", () => {
    expect(messageBriefDefinition).not.toContain("updated_at");
    expect(migration).not.toContain("create trigger lh_message_briefs_set_updated_at");
    expect(migration).not.toMatch(
      /grant select, insert, update on table [^;]*public\.lh_message_briefs/,
    );
  });

  it("protects outbox command content while allowing operational updates", () => {
    expect(migration).toContain(
      "create or replace function private.guard_lh_outbox_command()",
    );
    for (const column of [
      "id",
      "owner_id",
      "enrollment_id",
      "message_version_id",
      "recipient_email",
      "subject",
      "body",
      "due_at",
      "logical_step",
      "idempotency_key",
      "created_at",
    ]) {
      expect(outboxGuard).toContain(`new.${column} is distinct from old.${column}`);
    }
    for (const operationalColumn of [
      "state",
      "attempt_count",
      "lease_owner",
      "lease_expires_at",
      "provider_message_id",
      "last_error",
      "updated_at",
    ]) {
      expect(outboxGuard).not.toContain(
        `new.${operationalColumn} is distinct from old.${operationalColumn}`,
      );
    }
    expect(migration).toContain(
      "revoke all on function private.guard_lh_outbox_command() from public, anon, authenticated",
    );
    expect(migration).toContain(
      "create trigger lh_outbox_guard_command before update on public.lh_outbox for each row execute function private.guard_lh_outbox_command()",
    );
  });

  it("records the generated snapshot after migration 0009", () => {
    expect(existsSync(snapshotPath)).toBe(true);
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 10,
      tag: "0010_add_leadhunter_pipeline",
    });

    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
      prevId: string;
    };
    const previousSnapshot = JSON.parse(readFileSync(
      resolve(process.cwd(), "supabase/migrations/meta/0009_snapshot.json"),
      "utf8",
    )) as { id: string };
    expect(snapshot.prevId).toBe(previousSnapshot.id);
  });

  it("is forward-only", () => {
    expect(migration).not.toMatch(/drop\s+(?:table|type)|truncate/);
  });
});
