import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { clients } from "./clients";
import { kazeosBackendRole } from "./roles";
import {
  auditColumns,
  authenticatedOwnerPolicies,
  ownerIdColumn,
} from "./shared";
import type { CampaignStrategy } from "@/lib/leadhunter/contracts";

export const leadHunterCampaignStatusEnum = pgEnum("lh_campaign_status", [
  "draft",
  "active",
  "paused",
  "archived",
]);

export const leadHunterAutomationModeEnum = pgEnum("lh_automation_mode", [
  "drafts",
  "automatic",
]);

export const leadHunterLeadStatusEnum = pgEnum("lh_lead_status", [
  "new",
  "researching",
  "qualified",
  "excluded",
  "converted",
  "archived",
]);

export const leadHunterEvaluationEnum = pgEnum("lh_evaluation", [
  "pending",
  "eligible",
  "excluded",
  "needs_review",
  "no_email",
]);

export const leadHunterEnrollmentStatusEnum = pgEnum("lh_enrollment_status", [
  "researching",
  "ready",
  "contacting",
  "replied",
  "completed",
  "stopped",
]);

export const leadHunterEvidenceKindEnum = pgEnum("lh_evidence_kind", [
  "fact",
  "hypothesis",
]);

export const leadHunterActorTypeEnum = pgEnum("lh_actor_type", [
  "human",
  "system",
  "agent",
]);

export const leadHunterRunStateEnum = pgEnum("lh_run_state", [
  "planned",
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

export const leadHunterJobStateEnum = pgEnum("lh_job_state", [
  "queued",
  "leased",
  "succeeded",
  "failed",
  "cancelled",
]);

export const leadHunterJobKindEnum = pgEnum("lh_job_kind", [
  "discover",
  "resolve_identity",
  "research",
  "audit_website",
  "qualify",
  "enrich_contact",
  "prepare_message",
  "validate_message",
]);

export const leadHunterMessageStateEnum = pgEnum("lh_message_state", [
  "draft",
  "valid",
  "invalid",
  "superseded",
]);

export const leadHunterOutboxStateEnum = pgEnum("lh_outbox_state", [
  "queued",
  "leased",
  "provider_accepted",
  "failed",
  "unknown",
  "cancelled",
]);

export interface LeadHunterSequenceStep {
  delayDays: number;
  subjectInstruction: string;
  bodyInstruction: string;
}

export interface LeadHunterSchedule {
  searchDays: string[];
  searchTime: string;
  sendDays: string[];
  sendStart: string;
  sendEnd: string;
  timezone: string;
}

export interface LeadHunterCampaignSnapshot {
  objective: string;
  serviceFocus: string;
  countries: string[];
  sources: string[];
  positiveCriteria: string[];
  negativeCriteria: string[];
  strategy: CampaignStrategy;
  schedule: LeadHunterSchedule;
  dailyLeadLimit: number;
  dailyEmailLimit: number;
  sequenceSteps: LeadHunterSequenceStep[];
}

const backendPolicies = (tableName: string, ownerColumn: Parameters<typeof authenticatedOwnerPolicies>[1]) =>
  authenticatedOwnerPolicies(tableName, ownerColumn, {
    writePolicyAudience: "backend",
    writeRole: kazeosBackendRole,
  });

const backendInsertPolicies = (
  tableName: string,
  ownerColumn: Parameters<typeof authenticatedOwnerPolicies>[1],
) => backendPolicies(tableName, ownerColumn).filter(
  (policy) => policy.name !== `${tableName}_backend_update`,
);

function messageVersionEnrollmentForeignColumns(): [
  AnyPgColumn,
  AnyPgColumn,
  AnyPgColumn,
] {
  return [
    leadHunterMessageVersions.ownerId,
    leadHunterMessageVersions.id,
    leadHunterMessageVersions.enrollmentId,
  ];
}

export const leadHunterCampaigns = pgTable(
  "lh_campaigns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    name: text("name").notNull(),
    objective: text("objective").notNull(),
    serviceFocus: text("service_focus").notNull(),
    status: leadHunterCampaignStatusEnum("status").default("draft").notNull(),
    automationMode: leadHunterAutomationModeEnum("automation_mode")
      .default("drafts")
      .notNull(),
    mailboxId: uuid("mailbox_id"),
    countries: jsonb("countries").$type<string[]>().notNull(),
    sources: jsonb("sources").$type<string[]>().notNull(),
    positiveCriteria: jsonb("positive_criteria").$type<string[]>().notNull(),
    negativeCriteria: jsonb("negative_criteria").$type<string[]>().notNull(),
    schedule: jsonb("schedule").$type<LeadHunterSchedule>().notNull(),
    sequenceSteps: jsonb("sequence_steps")
      .$type<LeadHunterSequenceStep[]>()
      .notNull(),
    dailyLeadLimit: integer("daily_lead_limit").notNull(),
    dailyEmailLimit: integer("daily_email_limit").notNull(),
    configVersion: integer("config_version").default(1).notNull(),
    nextSearchAt: timestamp("next_search_at", { withTimezone: true, mode: "date" }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true, mode: "date" }),
    ...auditColumns(),
  },
  (table) => [
    check("lh_campaigns_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("lh_campaigns_objective_not_blank", sql`btrim(${table.objective}) <> ''`),
    check("lh_campaigns_daily_lead_limit_positive", sql`${table.dailyLeadLimit} > 0`),
    check("lh_campaigns_daily_email_limit_positive", sql`${table.dailyEmailLimit} > 0`),
    check("lh_campaigns_config_version_positive", sql`${table.configVersion} > 0`),
    unique("lh_campaigns_owner_id_id_unique").on(table.ownerId, table.id),
    index("lh_campaigns_owner_status_idx").on(table.ownerId, table.status),
    index("lh_campaigns_owner_next_search_idx").on(table.ownerId, table.nextSearchAt),
    ...backendPolicies("lh_campaigns", table.ownerId),
  ],
).enableRLS();

export const leadHunterCampaignVersions = pgTable(
  "lh_campaign_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    campaignId: uuid("campaign_id").notNull(),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<LeadHunterCampaignSnapshot>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("lh_campaign_versions_version_positive", sql`${table.version} > 0`),
    unique("lh_campaign_versions_owner_id_id_unique").on(table.ownerId, table.id),
    unique("lh_campaign_versions_number_unique").on(
      table.ownerId,
      table.campaignId,
      table.version,
    ),
    foreignKey({
      name: "lh_campaign_versions_owner_campaign_campaigns_owner_id_id_fk",
      columns: [table.ownerId, table.campaignId],
      foreignColumns: [leadHunterCampaigns.ownerId, leadHunterCampaigns.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    ...backendPolicies("lh_campaign_versions", table.ownerId),
  ],
).enableRLS();

export const leadHunterRuns = pgTable(
  "lh_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    campaignId: uuid("campaign_id").notNull(),
    campaignVersion: integer("campaign_version").notNull(),
    plan: jsonb("plan").$type<Record<string, unknown>>().notNull(),
    cursor: jsonb("cursor")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    state: leadHunterRunStateEnum("state").default("planned").notNull(),
    counts: jsonb("counts")
      .$type<Record<string, number>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    ...auditColumns(),
  },
  (table) => [
    check("lh_runs_campaign_version_positive", sql`${table.campaignVersion} > 0`),
    check("lh_runs_plan_object", sql`jsonb_typeof(${table.plan}) = 'object'`),
    check("lh_runs_cursor_object", sql`jsonb_typeof(${table.cursor}) = 'object'`),
    check("lh_runs_counts_object", sql`jsonb_typeof(${table.counts}) = 'object'`),
    check(
      "lh_runs_finished_after_started",
      sql`${table.finishedAt} is null or ${table.startedAt} is null or ${table.finishedAt} >= ${table.startedAt}`,
    ),
    unique("lh_runs_owner_id_id_unique").on(table.ownerId, table.id),
    foreignKey({
      name: "lh_runs_owner_campaign_version_campaign_versions_owner_campaign_version_fk",
      columns: [table.ownerId, table.campaignId, table.campaignVersion],
      foreignColumns: [
        leadHunterCampaignVersions.ownerId,
        leadHunterCampaignVersions.campaignId,
        leadHunterCampaignVersions.version,
      ],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("lh_runs_owner_campaign_created_idx").on(
      table.ownerId,
      table.campaignId,
      table.createdAt,
    ),
    index("lh_runs_owner_state_idx").on(table.ownerId, table.state),
    ...backendPolicies("lh_runs", table.ownerId),
  ],
).enableRLS();

export const leadHunterLeads = pgTable(
  "lh_leads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    domain: text("domain"),
    website: text("website"),
    countryCode: text("country_code"),
    city: text("city"),
    description: text("description"),
    status: leadHunterLeadStatusEnum("status").default("new").notNull(),
    linkedClientId: uuid("linked_client_id"),
    ...auditColumns(),
  },
  (table) => [
    check("lh_leads_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("lh_leads_normalized_name_not_blank", sql`btrim(${table.normalizedName}) <> ''`),
    check(
      "lh_leads_country_code_format",
      sql`${table.countryCode} is null or ${table.countryCode} ~ '^[A-Z]{2}$'`,
    ),
    unique("lh_leads_owner_id_id_unique").on(table.ownerId, table.id),
    foreignKey({
      name: "lh_leads_owner_client_clients_owner_id_id_fk",
      columns: [table.ownerId, table.linkedClientId],
      foreignColumns: [clients.ownerId, clients.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("lh_leads_owner_status_idx").on(table.ownerId, table.status),
    index("lh_leads_owner_name_idx").on(table.ownerId, table.normalizedName),
    ...backendPolicies("lh_leads", table.ownerId),
  ],
).enableRLS();

export const leadHunterContacts = pgTable(
  "lh_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    leadId: uuid("lead_id").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    role: text("role"),
    email: text("email"),
    normalizedEmail: text("normalized_email"),
    phone: text("phone"),
    sourceUrl: text("source_url"),
    emailConfidence: smallint("email_confidence"),
    sourceType: text("source_type"),
    isPrimary: boolean("is_primary").default(false).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
    ...auditColumns(),
  },
  (table) => [
    check(
      "lh_contacts_email_confidence_range",
      sql`${table.emailConfidence} is null or ${table.emailConfidence} between 0 and 100`,
    ),
    unique("lh_contacts_owner_id_id_unique").on(table.ownerId, table.id),
    foreignKey({
      name: "lh_contacts_owner_lead_leads_owner_id_id_fk",
      columns: [table.ownerId, table.leadId],
      foreignColumns: [leadHunterLeads.ownerId, leadHunterLeads.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("lh_contacts_owner_lead_idx").on(table.ownerId, table.leadId),
    uniqueIndex("lh_contacts_owner_email_unique")
      .on(table.ownerId, table.normalizedEmail)
      .where(sql`${table.normalizedEmail} is not null`),
    uniqueIndex("lh_contacts_one_primary_per_lead_unique")
      .on(table.ownerId, table.leadId)
      .where(sql`${table.isPrimary} = true`),
    ...backendPolicies("lh_contacts", table.ownerId),
  ],
).enableRLS();

export const leadHunterEvidence = pgTable(
  "lh_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    leadId: uuid("lead_id").notNull(),
    runId: uuid("run_id"),
    campaignId: uuid("campaign_id"),
    kind: leadHunterEvidenceKindEnum("kind").notNull(),
    sourceType: text("source_type").notNull(),
    sourceUrl: text("source_url"),
    field: text("field").notNull(),
    value: text("value").notNull(),
    extract: text("extract"),
    contentHash: text("content_hash"),
    confidence: smallint("confidence").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    ...auditColumns(),
  },
  (table) => [
    check("lh_evidence_field_not_blank", sql`btrim(${table.field}) <> ''`),
    check("lh_evidence_value_not_blank", sql`btrim(${table.value}) <> ''`),
    check(
      "lh_evidence_content_hash_not_blank",
      sql`${table.contentHash} is null or btrim(${table.contentHash}) <> ''`,
    ),
    check("lh_evidence_confidence_range", sql`${table.confidence} between 0 and 100`),
    unique("lh_evidence_owner_id_id_unique").on(table.ownerId, table.id),
    foreignKey({
      name: "lh_evidence_owner_lead_leads_owner_id_id_fk",
      columns: [table.ownerId, table.leadId],
      foreignColumns: [leadHunterLeads.ownerId, leadHunterLeads.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "lh_evidence_owner_run_runs_owner_id_id_fk",
      columns: [table.ownerId, table.runId],
      foreignColumns: [leadHunterRuns.ownerId, leadHunterRuns.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "lh_evidence_owner_campaign_campaigns_owner_id_id_fk",
      columns: [table.ownerId, table.campaignId],
      foreignColumns: [leadHunterCampaigns.ownerId, leadHunterCampaigns.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("lh_evidence_owner_lead_idx").on(table.ownerId, table.leadId),
    index("lh_evidence_owner_run_idx").on(table.ownerId, table.runId),
    index("lh_evidence_owner_campaign_idx").on(table.ownerId, table.campaignId),
    ...backendPolicies("lh_evidence", table.ownerId),
  ],
).enableRLS();

export const leadHunterEnrollments = pgTable(
  "lh_enrollments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    campaignId: uuid("campaign_id").notNull(),
    leadId: uuid("lead_id").notNull(),
    campaignVersion: integer("campaign_version").notNull(),
    evaluation: leadHunterEvaluationEnum("evaluation").default("pending").notNull(),
    status: leadHunterEnrollmentStatusEnum("status").default("researching").notNull(),
    score: smallint("score"),
    reason: text("reason"),
    qualificationDetail: jsonb("qualification_detail").$type<Record<string, unknown>>(),
    researchSummary: jsonb("research_summary").$type<Record<string, unknown>>(),
    messageVersionId: uuid("message_version_id"),
    nextActionAt: timestamp("next_action_at", { withTimezone: true, mode: "date" }),
    ...auditColumns(),
  },
  (table) => [
    check("lh_enrollments_campaign_version_positive", sql`${table.campaignVersion} > 0`),
    check("lh_enrollments_score_range", sql`${table.score} is null or ${table.score} between 0 and 100`),
    unique("lh_enrollments_owner_id_id_unique").on(table.ownerId, table.id),
    unique("lh_enrollments_campaign_lead_unique").on(
      table.ownerId,
      table.campaignId,
      table.leadId,
    ),
    foreignKey({
      name: "lh_enrollments_owner_campaign_campaigns_owner_id_id_fk",
      columns: [table.ownerId, table.campaignId],
      foreignColumns: [leadHunterCampaigns.ownerId, leadHunterCampaigns.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "lh_enrollments_owner_lead_leads_owner_id_id_fk",
      columns: [table.ownerId, table.leadId],
      foreignColumns: [leadHunterLeads.ownerId, leadHunterLeads.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "lh_enrollments_owner_message_version_message_versions_owner_id_id_enrollment_id_fk",
      columns: [table.ownerId, table.messageVersionId, table.id],
      foreignColumns: messageVersionEnrollmentForeignColumns(),
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("lh_enrollments_owner_campaign_status_idx").on(
      table.ownerId,
      table.campaignId,
      table.status,
    ),
    index("lh_enrollments_owner_next_action_idx").on(table.ownerId, table.nextActionAt),
    index("lh_enrollments_owner_message_version_idx")
      .on(table.ownerId, table.messageVersionId, table.id)
      .where(sql`${table.messageVersionId} is not null`),
    ...backendPolicies("lh_enrollments", table.ownerId),
  ],
).enableRLS();

export const leadHunterActivities = pgTable(
  "lh_activity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    campaignId: uuid("campaign_id"),
    leadId: uuid("lead_id"),
    actorType: leadHunterActorTypeEnum("actor_type").notNull(),
    eventType: text("event_type").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("lh_activity_event_type_not_blank", sql`btrim(${table.eventType}) <> ''`),
    unique("lh_activity_owner_id_id_unique").on(table.ownerId, table.id),
    foreignKey({
      name: "lh_activity_owner_campaign_campaigns_owner_id_id_fk",
      columns: [table.ownerId, table.campaignId],
      foreignColumns: [leadHunterCampaigns.ownerId, leadHunterCampaigns.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "lh_activity_owner_lead_leads_owner_id_id_fk",
      columns: [table.ownerId, table.leadId],
      foreignColumns: [leadHunterLeads.ownerId, leadHunterLeads.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("lh_activity_owner_campaign_occurred_idx").on(
      table.ownerId,
      table.campaignId,
      table.occurredAt,
    ),
    index("lh_activity_owner_lead_occurred_idx").on(
      table.ownerId,
      table.leadId,
      table.occurredAt,
    ),
    ...backendPolicies("lh_activity", table.ownerId),
  ],
).enableRLS();

export const leadHunterJobs = pgTable(
  "lh_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    runId: uuid("run_id").notNull(),
    enrollmentId: uuid("enrollment_id"),
    leadId: uuid("lead_id"),
    kind: leadHunterJobKindEnum("kind").notNull(),
    state: leadHunterJobStateEnum("state").default("queued").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    idempotencyKey: text("idempotency_key").notNull(),
    lastError: text("last_error"),
    ...auditColumns(),
  },
  (table) => [
    check("lh_jobs_attempt_count_non_negative", sql`${table.attemptCount} >= 0`),
    check("lh_jobs_idempotency_key_not_blank", sql`btrim(${table.idempotencyKey}) <> ''`),
    check(
      "lh_jobs_lease_consistency",
      sql`${table.state} <> 'leased' or (${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null)`,
    ),
    unique("lh_jobs_owner_id_id_unique").on(table.ownerId, table.id),
    unique("lh_jobs_owner_idempotency_key_unique").on(
      table.ownerId,
      table.idempotencyKey,
    ),
    foreignKey({
      name: "lh_jobs_owner_run_runs_owner_id_id_fk",
      columns: [table.ownerId, table.runId],
      foreignColumns: [leadHunterRuns.ownerId, leadHunterRuns.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "lh_jobs_owner_enrollment_enrollments_owner_id_id_fk",
      columns: [table.ownerId, table.enrollmentId],
      foreignColumns: [leadHunterEnrollments.ownerId, leadHunterEnrollments.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "lh_jobs_owner_lead_leads_owner_id_id_fk",
      columns: [table.ownerId, table.leadId],
      foreignColumns: [leadHunterLeads.ownerId, leadHunterLeads.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("lh_jobs_owner_run_idx").on(table.ownerId, table.runId),
    index("lh_jobs_owner_enrollment_idx").on(table.ownerId, table.enrollmentId),
    index("lh_jobs_owner_lead_idx").on(table.ownerId, table.leadId),
    index("lh_jobs_claimable_idx")
      .on(table.ownerId, table.state, table.leaseExpiresAt, table.createdAt)
      .where(sql`${table.state} in ('queued', 'leased')`),
    ...backendPolicies("lh_jobs", table.ownerId),
  ],
).enableRLS();

export const leadHunterSourceCandidates = pgTable(
  "lh_source_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    runId: uuid("run_id").notNull(),
    sourceType: text("source_type").notNull(),
    sourceIdentity: text("source_identity").notNull(),
    query: text("query").notNull(),
    rawRecord: jsonb("raw_record").$type<Record<string, unknown>>().notNull(),
    canonicalUrl: text("canonical_url"),
    resolutionState: text("resolution_state").default("pending").notNull(),
    leadId: uuid("lead_id"),
    discoveredAt: timestamp("discovered_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    ...auditColumns(),
  },
  (table) => [
    check("lh_source_candidates_source_type_not_blank", sql`btrim(${table.sourceType}) <> ''`),
    check(
      "lh_source_candidates_source_identity_not_blank",
      sql`btrim(${table.sourceIdentity}) <> ''`,
    ),
    check("lh_source_candidates_query_not_blank", sql`btrim(${table.query}) <> ''`),
    check(
      "lh_source_candidates_resolution_state_valid",
      sql`${table.resolutionState} in ('pending', 'resolved', 'duplicate', 'needs_review', 'rejected')`,
    ),
    unique("lh_source_candidates_owner_id_id_unique").on(table.ownerId, table.id),
    unique("lh_source_candidates_source_identity_unique").on(
      table.ownerId,
      table.runId,
      table.sourceType,
      table.sourceIdentity,
    ),
    foreignKey({
      name: "lh_source_candidates_owner_run_runs_owner_id_id_fk",
      columns: [table.ownerId, table.runId],
      foreignColumns: [leadHunterRuns.ownerId, leadHunterRuns.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "lh_source_candidates_owner_lead_leads_owner_id_id_fk",
      columns: [table.ownerId, table.leadId],
      foreignColumns: [leadHunterLeads.ownerId, leadHunterLeads.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("lh_source_candidates_owner_run_resolution_idx").on(
      table.ownerId,
      table.runId,
      table.resolutionState,
    ),
    index("lh_source_candidates_owner_lead_idx").on(table.ownerId, table.leadId),
    ...backendPolicies("lh_source_candidates", table.ownerId),
  ],
).enableRLS();

export const leadHunterWebsiteAudits = pgTable(
  "lh_website_audits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    runId: uuid("run_id").notNull(),
    enrollmentId: uuid("enrollment_id").notNull(),
    leadId: uuid("lead_id").notNull(),
    gateResult: text("gate_result").notNull(),
    checks: jsonb("checks").$type<Record<string, unknown>[]>().notNull(),
    summary: text("summary").notNull(),
    confidence: smallint("confidence").notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull(),
    ...auditColumns(),
  },
  (table) => [
    check(
      "lh_website_audits_gate_result_valid",
      sql`${table.gateResult} in ('NO_WEBSITE', 'BAD_WEBSITE', 'GOOD_ENOUGH_WEBSITE', 'UNVERIFIED')`,
    ),
    check("lh_website_audits_summary_not_blank", sql`btrim(${table.summary}) <> ''`),
    check("lh_website_audits_confidence_range", sql`${table.confidence} between 0 and 100`),
    unique("lh_website_audits_owner_id_id_unique").on(table.ownerId, table.id),
    unique("lh_website_audits_run_enrollment_unique").on(
      table.ownerId,
      table.runId,
      table.enrollmentId,
    ),
    foreignKey({
      name: "lh_website_audits_owner_run_runs_owner_id_id_fk",
      columns: [table.ownerId, table.runId],
      foreignColumns: [leadHunterRuns.ownerId, leadHunterRuns.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "lh_website_audits_owner_enrollment_enrollments_owner_id_id_fk",
      columns: [table.ownerId, table.enrollmentId],
      foreignColumns: [leadHunterEnrollments.ownerId, leadHunterEnrollments.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "lh_website_audits_owner_lead_leads_owner_id_id_fk",
      columns: [table.ownerId, table.leadId],
      foreignColumns: [leadHunterLeads.ownerId, leadHunterLeads.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("lh_website_audits_owner_enrollment_idx").on(
      table.ownerId,
      table.enrollmentId,
    ),
    index("lh_website_audits_owner_lead_idx").on(table.ownerId, table.leadId),
    ...backendPolicies("lh_website_audits", table.ownerId),
  ],
).enableRLS();

export const leadHunterMessageBriefs = pgTable(
  "lh_message_briefs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    enrollmentId: uuid("enrollment_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    campaignId: uuid("campaign_id").notNull(),
    campaignVersion: integer("campaign_version").notNull(),
    brief: jsonb("brief").$type<Record<string, unknown>>().notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "lh_message_briefs_campaign_version_positive",
      sql`${table.campaignVersion} > 0`,
    ),
    check("lh_message_briefs_brief_object", sql`jsonb_typeof(${table.brief}) = 'object'`),
    unique("lh_message_briefs_owner_id_id_unique").on(table.ownerId, table.id),
    unique("lh_message_briefs_owner_id_enrollment_unique").on(
      table.ownerId,
      table.id,
      table.enrollmentId,
    ),
    unique("lh_message_briefs_enrollment_version_unique").on(
      table.ownerId,
      table.enrollmentId,
      table.campaignVersion,
    ),
    foreignKey({
      name: "lh_message_briefs_owner_enrollment_enrollments_owner_id_id_fk",
      columns: [table.ownerId, table.enrollmentId],
      foreignColumns: [leadHunterEnrollments.ownerId, leadHunterEnrollments.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "lh_message_briefs_owner_contact_contacts_owner_id_id_fk",
      columns: [table.ownerId, table.contactId],
      foreignColumns: [leadHunterContacts.ownerId, leadHunterContacts.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "lh_message_briefs_owner_campaign_version_campaign_versions_owner_campaign_version_fk",
      columns: [table.ownerId, table.campaignId, table.campaignVersion],
      foreignColumns: [
        leadHunterCampaignVersions.ownerId,
        leadHunterCampaignVersions.campaignId,
        leadHunterCampaignVersions.version,
      ],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("lh_message_briefs_owner_enrollment_idx").on(
      table.ownerId,
      table.enrollmentId,
    ),
    index("lh_message_briefs_owner_contact_idx").on(table.ownerId, table.contactId),
    index("lh_message_briefs_owner_campaign_version_idx").on(
      table.ownerId,
      table.campaignId,
      table.campaignVersion,
    ),
    ...backendInsertPolicies("lh_message_briefs", table.ownerId),
  ],
).enableRLS();

export const leadHunterMessageVersions = pgTable(
  "lh_message_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    briefId: uuid("brief_id").notNull(),
    enrollmentId: uuid("enrollment_id").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    state: leadHunterMessageStateEnum("state").default("draft").notNull(),
    validationResult: jsonb("validation_result").$type<Record<string, unknown>>(),
    modelMetadata: jsonb("model_metadata").$type<Record<string, unknown>>(),
    supersedesMessageVersionId: uuid("supersedes_message_version_id"),
    ...auditColumns(),
  },
  (table) => [
    check("lh_message_versions_subject_not_blank", sql`btrim(${table.subject}) <> ''`),
    check("lh_message_versions_body_not_blank", sql`btrim(${table.body}) <> ''`),
    check(
      "lh_message_versions_validation_consistency",
      sql`${table.state} not in ('valid', 'invalid') or ${table.validationResult} is not null`,
    ),
    check(
      "lh_message_versions_not_self_superseding",
      sql`${table.supersedesMessageVersionId} is null or ${table.supersedesMessageVersionId} <> ${table.id}`,
    ),
    unique("lh_message_versions_owner_id_id_unique").on(table.ownerId, table.id),
    unique("lh_message_versions_owner_id_enrollment_unique").on(
      table.ownerId,
      table.id,
      table.enrollmentId,
    ),
    foreignKey({
      name: "lh_message_versions_owner_brief_message_briefs_owner_id_id_fk",
      columns: [table.ownerId, table.briefId, table.enrollmentId],
      foreignColumns: [
        leadHunterMessageBriefs.ownerId,
        leadHunterMessageBriefs.id,
        leadHunterMessageBriefs.enrollmentId,
      ],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "lh_message_versions_owner_enrollment_enrollments_owner_id_id_fk",
      columns: [table.ownerId, table.enrollmentId],
      foreignColumns: [leadHunterEnrollments.ownerId, leadHunterEnrollments.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "lh_message_versions_owner_supersedes_message_versions_owner_id_id_enrollment_id_fk",
      columns: [
        table.ownerId,
        table.supersedesMessageVersionId,
        table.enrollmentId,
      ],
      foreignColumns: [table.ownerId, table.id, table.enrollmentId],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("lh_message_versions_owner_brief_created_idx").on(
      table.ownerId,
      table.briefId,
      table.createdAt,
    ),
    index("lh_message_versions_owner_enrollment_idx").on(
      table.ownerId,
      table.enrollmentId,
    ),
    index("lh_message_versions_owner_supersedes_idx")
      .on(
        table.ownerId,
        table.supersedesMessageVersionId,
        table.enrollmentId,
      )
      .where(sql`${table.supersedesMessageVersionId} is not null`),
    ...backendPolicies("lh_message_versions", table.ownerId),
  ],
).enableRLS();

export const leadHunterOutbox = pgTable(
  "lh_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    enrollmentId: uuid("enrollment_id").notNull(),
    messageVersionId: uuid("message_version_id").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }).notNull(),
    logicalStep: integer("logical_step").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    state: leadHunterOutboxStateEnum("state").default("queued").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    providerMessageId: text("provider_message_id"),
    lastError: text("last_error"),
    ...auditColumns(),
  },
  (table) => [
    check("lh_outbox_recipient_email_not_blank", sql`btrim(${table.recipientEmail}) <> ''`),
    check("lh_outbox_subject_not_blank", sql`btrim(${table.subject}) <> ''`),
    check("lh_outbox_body_not_blank", sql`btrim(${table.body}) <> ''`),
    check("lh_outbox_logical_step_non_negative", sql`${table.logicalStep} >= 0`),
    check("lh_outbox_attempt_count_non_negative", sql`${table.attemptCount} >= 0`),
    check("lh_outbox_idempotency_key_not_blank", sql`btrim(${table.idempotencyKey}) <> ''`),
    check(
      "lh_outbox_lease_consistency",
      sql`${table.state} <> 'leased' or (${table.attemptCount} > 0 and ${table.leaseOwner} is not null and ${table.leaseExpiresAt} is not null)`,
    ),
    unique("lh_outbox_owner_id_id_unique").on(table.ownerId, table.id),
    unique("lh_outbox_owner_idempotency_key_unique").on(
      table.ownerId,
      table.idempotencyKey,
    ),
    uniqueIndex("lh_outbox_active_enrollment_logical_step_unique")
      .on(table.ownerId, table.enrollmentId, table.logicalStep)
      .where(sql`${table.state} <> 'cancelled' or ${table.leaseOwner} is not null or ${table.leaseExpiresAt} is not null`),
    foreignKey({
      name: "lh_outbox_owner_enrollment_enrollments_owner_id_id_fk",
      columns: [table.ownerId, table.enrollmentId],
      foreignColumns: [leadHunterEnrollments.ownerId, leadHunterEnrollments.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    foreignKey({
      name: "lh_outbox_owner_message_version_message_versions_owner_id_id_fk",
      columns: [table.ownerId, table.messageVersionId, table.enrollmentId],
      foreignColumns: [
        leadHunterMessageVersions.ownerId,
        leadHunterMessageVersions.id,
        leadHunterMessageVersions.enrollmentId,
      ],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("lh_outbox_owner_message_version_idx").on(
      table.ownerId,
      table.messageVersionId,
    ),
    index("lh_outbox_due_idx")
      .on(table.ownerId, table.dueAt)
      .where(sql`${table.state} = 'queued'`),
    ...backendPolicies("lh_outbox", table.ownerId),
  ],
).enableRLS();
