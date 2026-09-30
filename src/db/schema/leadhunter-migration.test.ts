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
const runtimeMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/0011_add_leadhunter_job_runtime.sql",
);
const runtimeSnapshotPath = resolve(
  process.cwd(),
  "supabase/migrations/meta/0011_snapshot.json",
);
const provenanceMigrationPath = resolve(
  process.cwd(),
  "supabase/migrations/0012_protect_leadhunter_source_provenance.sql",
);
const provenanceSnapshotPath = resolve(
  process.cwd(),
  "supabase/migrations/meta/0012_snapshot.json",
);
const migration = existsSync(migrationPath)
  ? normalizeSql(readFileSync(migrationPath, "utf8"))
  : "";
const runtimeMigration = existsSync(runtimeMigrationPath)
  ? normalizeSql(readFileSync(runtimeMigrationPath, "utf8"))
  : "";
const provenanceMigration = existsSync(provenanceMigrationPath)
  ? normalizeSql(readFileSync(provenanceMigrationPath, "utf8"))
  : "";
const sourceCandidateGuard = provenanceMigration.match(
  /create or replace function private\.guard_lh_source_candidate_provenance\(\)(.*?)\$\$;/,
)?.[1] ?? "";
const outboxGuard = migration.match(
  /create or replace function private\.guard_lh_outbox_command\(\)(.*?)\$\$;/,
)?.[1] ?? "";
const messageVersionGuard = migration.match(
  /create or replace function private\.guard_lh_message_version_content\(\)(.*?)\$\$;/,
)?.[1] ?? "";
const messageBriefCoherenceGuard = migration.match(
  /create or replace function private\.validate_lh_message_brief_coherence\(\)(.*?)\$\$;/,
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
    expect(migration).not.toContain(
      "constraint lh_outbox_enrollment_logical_step_unique unique(owner_id,enrollment_id,logical_step)",
    );
    expect(migration).toContain(
      "create unique index lh_outbox_active_enrollment_logical_step_unique on lh_outbox using btree (owner_id,enrollment_id,logical_step)",
    );
    expect(migration).toContain(
      "where lh_outbox.state <> 'cancelled' or lh_outbox.lease_owner is not null or lh_outbox.lease_expires_at is not null",
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
    expect(migration).toContain(
      "constraint lh_message_versions_owner_supersedes_message_versions_owner_id_id_enrollment_id_fk foreign key (owner_id,supersedes_message_version_id,enrollment_id) references public.lh_message_versions(owner_id,id,enrollment_id)",
    );
    expect(migration).toContain("create index lh_jobs_claimable_idx");
    expect(migration).toContain("where lh_jobs.state in ('queued', 'leased')");
    expect(migration).toContain("create index lh_outbox_due_idx");
    expect(migration).toContain("where lh_outbox.state = 'queued'");
    expect(migration).toContain(
      "create index lh_outbox_owner_enrollment_idx on lh_outbox using btree (owner_id,enrollment_id)",
    );
    expect(migration).toContain("create index lh_enrollments_owner_message_version_idx");
    expect(migration).toContain("create index lh_message_versions_owner_supersedes_idx");
    expect(migration).toContain("create index lh_message_briefs_owner_campaign_version_idx");
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
    expect(migration).toContain(
      "revoke update on table public.lh_message_briefs from kazeos_backend, service_role",
    );
  });

  it("validates message brief contact and campaign coherence on insert", () => {
    expect(messageBriefCoherenceGuard).toContain(
      "from public.lh_enrollments as enrollment",
    );
    expect(messageBriefCoherenceGuard).toContain(
      "join public.lh_contacts as contact",
    );
    expect(messageBriefCoherenceGuard).toContain(
      "contact.lead_id = enrollment.lead_id",
    );
    expect(messageBriefCoherenceGuard).toContain(
      "enrollment.campaign_id = new.campaign_id",
    );
    expect(messageBriefCoherenceGuard).toContain(
      "enrollment.campaign_version = new.campaign_version",
    );
    expect(messageBriefCoherenceGuard).toContain(
      "for share of enrollment, contact",
    );
    expect(messageBriefCoherenceGuard).not.toContain("for key share");
    expect(migration).toContain(
      "create trigger lh_message_briefs_validate_coherence before insert on public.lh_message_briefs for each row execute function private.validate_lh_message_brief_coherence()",
    );
  });

  it("protects outbox command content while allowing controlled operational updates", () => {
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
      "attempt_count",
      "lease_owner",
      "lease_expires_at",
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

  it("enforces safe outbox state transitions and cancellation", () => {
    expect(outboxGuard).toContain(
      "old.state in ('provider_accepted', 'cancelled')",
    );
    expect(outboxGuard).toContain(
      "old.state = 'queued' and new.state = 'leased'",
    );
    expect(outboxGuard).toContain(
      "old.state = 'leased' and new.state in ('queued', 'provider_accepted', 'failed', 'unknown')",
    );
    expect(outboxGuard).toContain(
      "old.state = 'failed' and new.state = 'queued'",
    );
    expect(outboxGuard).toContain(
      "old.state = 'unknown' and new.state in ('provider_accepted', 'failed')",
    );
    for (const cancellationGuard of [
      "old.state <> 'queued'",
      "old.attempt_count <> 0",
      "new.attempt_count <> 0",
      "old.lease_owner is not null",
      "old.lease_expires_at is not null",
      "old.provider_message_id is not null",
      "new.lease_owner is not null",
      "new.lease_expires_at is not null",
      "new.provider_message_id is not null",
    ]) {
      expect(outboxGuard).toContain(cancellationGuard);
    }
    expect(outboxGuard).toContain(
      "new.attempt_count < old.attempt_count",
    );
    expect(outboxGuard).toContain(
      "new.state = 'leased' and new.attempt_count <= old.attempt_count",
    );
    expect(outboxGuard).toContain(
      "old.provider_message_id is not null and new.provider_message_id is distinct from old.provider_message_id",
    );
    expect(outboxGuard).toContain(
      "new.state = 'cancelled' and (new.attempt_count <> 0 or new.lease_owner is not null or new.lease_expires_at is not null or new.provider_message_id is not null)",
    );
    expect(migration).toContain(
      "constraint lh_outbox_lease_consistency check (lh_outbox.state <> 'leased' or (lh_outbox.attempt_count > 0 and lh_outbox.lease_owner is not null and lh_outbox.lease_expires_at is not null))",
    );
    expect(migration).toContain(
      "constraint lh_outbox_cancelled_consistency check (lh_outbox.state <> 'cancelled' or (lh_outbox.attempt_count = 0 and lh_outbox.lease_owner is null and lh_outbox.lease_expires_at is null and lh_outbox.provider_message_id is null))",
    );
    expect(migration).toContain(
      "constraint lh_outbox_queued_consistency check (lh_outbox.state <> 'queued' or (lh_outbox.lease_owner is null and lh_outbox.lease_expires_at is null and lh_outbox.provider_message_id is null))",
    );
    expect(outboxGuard).toContain(
      "new.state = 'queued' and (new.lease_owner is not null or new.lease_expires_at is not null or new.provider_message_id is not null)",
    );
  });

  it("protects message version content while allowing controlled validation updates", () => {
    expect(migration).toContain(
      "create or replace function private.guard_lh_message_version_content()",
    );
    for (const column of [
      "id",
      "owner_id",
      "brief_id",
      "enrollment_id",
      "subject",
      "body",
      "model_metadata",
      "supersedes_message_version_id",
      "created_at",
    ]) {
      expect(messageVersionGuard).toContain(
        `new.${column} is distinct from old.${column}`,
      );
    }
    for (const operationalColumn of ["updated_at"]) {
      expect(messageVersionGuard).not.toContain(
        `new.${operationalColumn} is distinct from old.${operationalColumn}`,
      );
    }
    expect(migration).toContain(
      "create trigger lh_message_versions_guard_content before update on public.lh_message_versions for each row execute function private.guard_lh_message_version_content()",
    );
  });

  it("freezes validation history after the first validation", () => {
    expect(messageVersionGuard).toContain(
      "old.state <> 'draft' and new.validation_result is distinct from old.validation_result",
    );
    expect(messageVersionGuard).toContain(
      "old.state = 'draft' and new.state in ('valid', 'invalid') and new.validation_result is not null",
    );
    expect(messageVersionGuard).toContain(
      "old.state = 'valid' and new.state = 'superseded'",
    );
    expect(messageVersionGuard).toContain(
      "new.state is distinct from old.state",
    );
  });

  it("records the generated snapshot after migration 0009", () => {
    expect(existsSync(snapshotPath)).toBe(true);
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries).toContainEqual(expect.objectContaining({
      idx: 10,
      tag: "0010_add_leadhunter_pipeline",
    }));

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

describe("LeadHunter job runtime migration", () => {
  it("adds a durable run slot and a digest-only lease credential", () => {
    expect(runtimeMigration).toContain(
      "alter table lh_runs add column scheduled_for timestamp with time zone",
    );
    expect(runtimeMigration).toContain(
      "alter table lh_runs alter column scheduled_for set not null",
    );
    expect(runtimeMigration).toContain(
      "alter table lh_jobs add column lease_token_digest text",
    );
    expect(runtimeMigration).toContain(
      "create unique index lh_runs_active_slot_unique on lh_runs using btree (owner_id,campaign_id,campaign_version,scheduled_for)",
    );
    expect(runtimeMigration).toContain(
      "where lh_runs.state in ('planned', 'running')",
    );
    expect(runtimeMigration).toContain("lh_jobs_lease_token_digest_format");
    expect(runtimeMigration).not.toContain("lease_token text");
  });

  it("records 0011 without rewriting the committed 0010 history", () => {
    expect(existsSync(runtimeSnapshotPath)).toBe(true);
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.find(({ tag }) => (
      tag === "0011_add_leadhunter_job_runtime"
    ))).toMatchObject({
      idx: 11,
      tag: "0011_add_leadhunter_job_runtime",
    });

    const runtimeSnapshot = JSON.parse(
      readFileSync(runtimeSnapshotPath, "utf8"),
    ) as { prevId: string };
    const pipelineSnapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
      id: string;
    };
    expect(runtimeSnapshot.prevId).toBe(pipelineSnapshot.id);
  });

  it("is forward-only", () => {
    expect(runtimeMigration).not.toMatch(/drop\s+(?:table|type)|truncate/);
  });
});

describe("LeadHunter source provenance migration", () => {
  it("freezes discovered provenance while allowing resolution state", () => {
    expect(provenanceMigration).toContain(
      "create or replace function private.guard_lh_source_candidate_provenance()",
    );
    for (const column of [
      "id",
      "owner_id",
      "run_id",
      "source_type",
      "source_identity",
      "query",
      "raw_record",
      "canonical_url",
      "discovered_at",
      "created_at",
    ]) {
      expect(sourceCandidateGuard).toContain(
        `new.${column} is distinct from old.${column}`,
      );
    }
    for (const allowedColumn of ["resolution_state", "lead_id", "updated_at"]) {
      expect(sourceCandidateGuard).not.toContain(
        `new.${allowedColumn} is distinct from old.${allowedColumn}`,
      );
    }
    expect(provenanceMigration).toContain(
      "create trigger lh_source_candidates_guard_provenance before update on public.lh_source_candidates for each row execute function private.guard_lh_source_candidate_provenance()",
    );
  });

  it("is forward-only", () => {
    expect(provenanceMigration).not.toMatch(/drop\s+(?:table|type)|truncate/);
  });

  it("records 0012 after the job runtime migration", () => {
    expect(existsSync(provenanceSnapshotPath)).toBe(true);
    const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.at(-1)).toMatchObject({
      idx: 12,
      tag: "0012_protect_leadhunter_source_provenance",
    });

    const provenanceSnapshot = JSON.parse(
      readFileSync(provenanceSnapshotPath, "utf8"),
    ) as { prevId: string };
    const runtimeSnapshot = JSON.parse(
      readFileSync(runtimeSnapshotPath, "utf8"),
    ) as { id: string };
    expect(provenanceSnapshot.prevId).toBe(runtimeSnapshot.id);
  });
});
