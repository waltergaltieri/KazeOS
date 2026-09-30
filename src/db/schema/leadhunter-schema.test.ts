// @vitest-environment node

import { getTableName } from "drizzle-orm";
import {
  type AnyPgTable,
  getTableConfig,
} from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "./index";

type OptionalTable = AnyPgTable | undefined;
type OptionalEnum = { enumValues: string[] } | undefined;

const leadHunterCampaigns = schema.leadHunterCampaigns;
const leadHunterCampaignVersions = schema.leadHunterCampaignVersions;
const leadHunterLeads = schema.leadHunterLeads;
const leadHunterContacts = schema.leadHunterContacts;
const leadHunterEvidence = schema.leadHunterEvidence;
const leadHunterEnrollments = schema.leadHunterEnrollments;
const leadHunterActivities = schema.leadHunterActivities;
const leadHunterRuns = (schema as Record<string, unknown>)
  .leadHunterRuns as OptionalTable;
const leadHunterJobs = (schema as Record<string, unknown>)
  .leadHunterJobs as OptionalTable;
const leadHunterSourceCandidates = (schema as Record<string, unknown>)
  .leadHunterSourceCandidates as OptionalTable;
const leadHunterWebsiteAudits = (schema as Record<string, unknown>)
  .leadHunterWebsiteAudits as OptionalTable;
const leadHunterMessageBriefs = (schema as Record<string, unknown>)
  .leadHunterMessageBriefs as OptionalTable;
const leadHunterMessageVersions = (schema as Record<string, unknown>)
  .leadHunterMessageVersions as OptionalTable;
const leadHunterOutbox = (schema as Record<string, unknown>)
  .leadHunterOutbox as OptionalTable;

const pipelineTables = [
  leadHunterRuns,
  leadHunterJobs,
  leadHunterSourceCandidates,
  leadHunterWebsiteAudits,
  leadHunterMessageBriefs,
  leadHunterMessageVersions,
  leadHunterOutbox,
];

const mutablePipelineTableNames = new Set([
  "lh_runs",
  "lh_jobs",
  "lh_source_candidates",
  "lh_website_audits",
  "lh_message_versions",
  "lh_outbox",
]);

const foundationTables = [
  leadHunterCampaigns,
  leadHunterCampaignVersions,
  leadHunterLeads,
  leadHunterContacts,
  leadHunterEvidence,
  leadHunterEnrollments,
  leadHunterActivities,
] as const;

function requireTable(table: OptionalTable) {
  expect(table).toBeDefined();
  return table as AnyPgTable;
}

function columnNames(table: AnyPgTable) {
  return getTableConfig(table).columns.map((column) => column.name);
}

function foreignKeyNames(table: AnyPgTable) {
  return getTableConfig(table).foreignKeys.map((foreignKey) => foreignKey.getName());
}

function foreignKeyContract(table: AnyPgTable, name: string) {
  const foreignKey = getTableConfig(table).foreignKeys.find(
    (candidate) => candidate.getName() === name,
  );
  const reference = foreignKey?.reference();

  return {
    columns: reference?.columns.map((column) => column.name),
    foreignColumns: reference?.foreignColumns.map((column) => column.name),
  };
}

function uniqueConstraintNames(table: AnyPgTable) {
  return getTableConfig(table).uniqueConstraints.map((constraint) => constraint.name);
}

function indexNames(table: AnyPgTable) {
  return getTableConfig(table).indexes.map((index) => index.config.name);
}

function indexContract(table: AnyPgTable, name: string) {
  const index = getTableConfig(table).indexes.find(
    (candidate) => candidate.config.name === name,
  );

  return {
    unique: index?.config.unique,
    partial: index?.config.where !== undefined,
  };
}

function checkNames(table: AnyPgTable) {
  return getTableConfig(table).checks.map((constraint) => constraint.name);
}

describe("LeadHunter schema contract", () => {
  it("exports the foundation and durable pipeline tables", () => {
    const tables = [...foundationTables, ...pipelineTables.map(requireTable)];

    expect(tables.map(getTableName)).toEqual([
      "lh_campaigns",
      "lh_campaign_versions",
      "lh_leads",
      "lh_contacts",
      "lh_evidence",
      "lh_enrollments",
      "lh_activity",
      "lh_runs",
      "lh_jobs",
      "lh_source_candidates",
      "lh_website_audits",
      "lh_message_briefs",
      "lh_message_versions",
      "lh_outbox",
    ]);
  });

  it("defines the pipeline state enums explicitly", () => {
    expect(
      ((schema as Record<string, unknown>).leadHunterRunStateEnum as OptionalEnum)
        ?.enumValues,
    ).toEqual(["planned", "running", "completed", "partial", "failed", "cancelled"]);
    expect(
      ((schema as Record<string, unknown>).leadHunterJobStateEnum as OptionalEnum)
        ?.enumValues,
    ).toEqual(["queued", "leased", "succeeded", "failed", "cancelled"]);
    expect(
      ((schema as Record<string, unknown>).leadHunterJobKindEnum as OptionalEnum)
        ?.enumValues,
    ).toEqual([
      "discover",
      "resolve_identity",
      "research",
      "audit_website",
      "qualify",
      "enrich_contact",
      "prepare_message",
      "validate_message",
    ]);
    expect(
      ((schema as Record<string, unknown>).leadHunterMessageStateEnum as OptionalEnum)
        ?.enumValues,
    ).toEqual(["draft", "valid", "invalid", "superseded"]);
    expect(
      ((schema as Record<string, unknown>).leadHunterOutboxStateEnum as OptionalEnum)
        ?.enumValues,
    ).toEqual(["queued", "leased", "provider_accepted", "failed", "unknown", "cancelled"]);
  });

  it("stores the durable fields required by every pipeline stage", () => {
    expect(columnNames(requireTable(leadHunterRuns))).toEqual(expect.arrayContaining([
      "campaign_id",
      "campaign_version",
      "plan",
      "cursor",
      "state",
      "counts",
      "started_at",
      "finished_at",
    ]));
    expect(columnNames(requireTable(leadHunterJobs))).toEqual(expect.arrayContaining([
      "run_id",
      "enrollment_id",
      "lead_id",
      "kind",
      "state",
      "payload",
      "result",
      "attempt_count",
      "lease_owner",
      "lease_expires_at",
      "idempotency_key",
      "last_error",
    ]));
    expect(columnNames(requireTable(leadHunterSourceCandidates))).toEqual(expect.arrayContaining([
      "run_id",
      "source_type",
      "source_identity",
      "query",
      "raw_record",
      "canonical_url",
      "resolution_state",
      "lead_id",
    ]));
    expect(columnNames(requireTable(leadHunterWebsiteAudits))).toEqual(expect.arrayContaining([
      "run_id",
      "enrollment_id",
      "lead_id",
      "gate_result",
      "checks",
      "summary",
      "confidence",
      "evidence_ids",
    ]));
    expect(columnNames(requireTable(leadHunterMessageBriefs))).toEqual(expect.arrayContaining([
      "enrollment_id",
      "contact_id",
      "campaign_id",
      "campaign_version",
      "brief",
      "evidence_ids",
    ]));
    expect(columnNames(requireTable(leadHunterMessageBriefs))).not.toContain("updated_at");
    expect(columnNames(requireTable(leadHunterMessageVersions))).toEqual(expect.arrayContaining([
      "brief_id",
      "enrollment_id",
      "subject",
      "body",
      "state",
      "validation_result",
      "model_metadata",
      "supersedes_message_version_id",
    ]));
    expect(columnNames(requireTable(leadHunterOutbox))).toEqual(expect.arrayContaining([
      "enrollment_id",
      "message_version_id",
      "recipient_email",
      "subject",
      "body",
      "due_at",
      "logical_step",
      "idempotency_key",
      "state",
    ]));
  });

  it("extends contacts, enrollments and evidence with pipeline provenance", () => {
    expect(columnNames(leadHunterContacts)).toEqual(expect.arrayContaining([
      "email_confidence",
      "source_type",
      "is_primary",
      "verified_at",
    ]));
    expect(columnNames(leadHunterEnrollments)).toEqual(expect.arrayContaining([
      "qualification_detail",
      "research_summary",
      "message_version_id",
    ]));
    expect(columnNames(leadHunterEvidence)).toEqual(expect.arrayContaining([
      "run_id",
      "campaign_id",
      "extract",
      "content_hash",
    ]));
  });

  it("keeps every pipeline table owner-scoped with backend-only writes", () => {
    for (const optionalTable of pipelineTables) {
      const table = requireTable(optionalTable);
      const config = getTableConfig(table);
      const policyNames = config.policies.map((policy) => policy.name);

      expect(config.columns.some((column) => column.name === "owner_id")).toBe(true);
      expect(config.enableRLS).toBe(true);
      expect(policyNames).toContain(`${getTableName(table)}_authenticated_select`);
      expect(policyNames).toContain(`${getTableName(table)}_backend_insert`);
      expect(policyNames).not.toContain(`${getTableName(table)}_authenticated_insert`);
      expect(policyNames).not.toContain(`${getTableName(table)}_authenticated_update`);
      if (mutablePipelineTableNames.has(getTableName(table))) {
        expect(policyNames).toContain(`${getTableName(table)}_backend_update`);
      } else {
        expect(policyNames).not.toContain(`${getTableName(table)}_backend_update`);
      }
    }
  });

  it("uses owner-scoped composite foreign keys throughout the pipeline", () => {
    expect(foreignKeyNames(requireTable(leadHunterRuns))).toContain(
      "lh_runs_owner_campaign_version_campaign_versions_owner_campaign_version_fk",
    );
    expect(foreignKeyNames(requireTable(leadHunterJobs))).toEqual(expect.arrayContaining([
      "lh_jobs_owner_run_runs_owner_id_id_fk",
      "lh_jobs_owner_enrollment_enrollments_owner_id_id_fk",
      "lh_jobs_owner_lead_leads_owner_id_id_fk",
    ]));
    expect(foreignKeyNames(requireTable(leadHunterSourceCandidates))).toEqual(expect.arrayContaining([
      "lh_source_candidates_owner_run_runs_owner_id_id_fk",
      "lh_source_candidates_owner_lead_leads_owner_id_id_fk",
    ]));
    expect(foreignKeyNames(requireTable(leadHunterWebsiteAudits))).toEqual(expect.arrayContaining([
      "lh_website_audits_owner_run_runs_owner_id_id_fk",
      "lh_website_audits_owner_enrollment_enrollments_owner_id_id_fk",
      "lh_website_audits_owner_lead_leads_owner_id_id_fk",
    ]));
    expect(foreignKeyNames(requireTable(leadHunterMessageBriefs))).toContain(
      "lh_message_briefs_owner_enrollment_enrollments_owner_id_id_fk",
    );
    expect(foreignKeyNames(requireTable(leadHunterMessageBriefs))).toContain(
      "lh_message_briefs_owner_contact_contacts_owner_id_id_fk",
    );
    expect(foreignKeyNames(requireTable(leadHunterMessageVersions))).toContain(
      "lh_message_versions_owner_brief_message_briefs_owner_id_id_fk",
    );
    expect(foreignKeyNames(requireTable(leadHunterOutbox))).toEqual(expect.arrayContaining([
      "lh_outbox_owner_enrollment_enrollments_owner_id_id_fk",
      "lh_outbox_owner_message_version_message_versions_owner_id_id_fk",
    ]));
    expect(foreignKeyContract(
      requireTable(leadHunterMessageVersions),
      "lh_message_versions_owner_brief_message_briefs_owner_id_id_fk",
    )).toEqual({
      columns: ["owner_id", "brief_id", "enrollment_id"],
      foreignColumns: ["owner_id", "id", "enrollment_id"],
    });
    expect(foreignKeyContract(
      requireTable(leadHunterOutbox),
      "lh_outbox_owner_message_version_message_versions_owner_id_id_fk",
    )).toEqual({
      columns: ["owner_id", "message_version_id", "enrollment_id"],
      foreignColumns: ["owner_id", "id", "enrollment_id"],
    });
    expect(foreignKeyContract(
      leadHunterEnrollments,
      "lh_enrollments_owner_message_version_message_versions_owner_id_id_enrollment_id_fk",
    )).toEqual({
      columns: ["owner_id", "message_version_id", "id"],
      foreignColumns: ["owner_id", "id", "enrollment_id"],
    });
  });

  it("deduplicates jobs, discoveries, message versions and active transport commands", () => {
    expect(uniqueConstraintNames(requireTable(leadHunterJobs))).toContain(
      "lh_jobs_owner_idempotency_key_unique",
    );
    expect(uniqueConstraintNames(requireTable(leadHunterSourceCandidates))).toContain(
      "lh_source_candidates_source_identity_unique",
    );
    expect(uniqueConstraintNames(requireTable(leadHunterMessageBriefs))).toContain(
      "lh_message_briefs_enrollment_version_unique",
    );
    expect(uniqueConstraintNames(requireTable(leadHunterMessageBriefs))).toContain(
      "lh_message_briefs_owner_id_enrollment_unique",
    );
    expect(uniqueConstraintNames(requireTable(leadHunterMessageVersions))).toContain(
      "lh_message_versions_owner_id_enrollment_unique",
    );
    expect(uniqueConstraintNames(requireTable(leadHunterOutbox))).toContain(
      "lh_outbox_owner_idempotency_key_unique",
    );
    expect(uniqueConstraintNames(requireTable(leadHunterOutbox))).not.toContain(
      "lh_outbox_enrollment_logical_step_unique",
    );
    expect(indexContract(
      requireTable(leadHunterOutbox),
      "lh_outbox_active_enrollment_logical_step_unique",
    )).toEqual({ unique: true, partial: true });
  });

  it("checks scores, confidence values and non-negative attempts", () => {
    expect(checkNames(leadHunterContacts)).toContain("lh_contacts_email_confidence_range");
    expect(checkNames(leadHunterEvidence)).toContain("lh_evidence_confidence_range");
    expect(checkNames(leadHunterEnrollments)).toContain("lh_enrollments_score_range");
    expect(checkNames(requireTable(leadHunterWebsiteAudits))).toContain(
      "lh_website_audits_confidence_range",
    );
    expect(checkNames(requireTable(leadHunterJobs))).toContain(
      "lh_jobs_attempt_count_non_negative",
    );
  });

  it("indexes claimable work and supporting foreign keys", () => {
    expect(indexNames(requireTable(leadHunterJobs))).toContain("lh_jobs_claimable_idx");
    expect(indexNames(requireTable(leadHunterOutbox))).toContain("lh_outbox_due_idx");
    expect(indexNames(leadHunterEnrollments)).toContain(
      "lh_enrollments_owner_message_version_idx",
    );
    expect(indexNames(requireTable(leadHunterMessageVersions))).toContain(
      "lh_message_versions_owner_supersedes_idx",
    );
    expect(indexNames(requireTable(leadHunterMessageBriefs))).toContain(
      "lh_message_briefs_owner_campaign_version_idx",
    );
  });
});
