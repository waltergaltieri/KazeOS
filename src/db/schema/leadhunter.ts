import { sql } from "drizzle-orm";
import {
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
    ...auditColumns(),
  },
  (table) => [
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
    ...backendPolicies("lh_contacts", table.ownerId),
  ],
).enableRLS();

export const leadHunterEvidence = pgTable(
  "lh_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    leadId: uuid("lead_id").notNull(),
    kind: leadHunterEvidenceKindEnum("kind").notNull(),
    sourceType: text("source_type").notNull(),
    sourceUrl: text("source_url"),
    field: text("field").notNull(),
    value: text("value").notNull(),
    confidence: smallint("confidence").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    ...auditColumns(),
  },
  (table) => [
    check("lh_evidence_field_not_blank", sql`btrim(${table.field}) <> ''`),
    check("lh_evidence_value_not_blank", sql`btrim(${table.value}) <> ''`),
    check("lh_evidence_confidence_range", sql`${table.confidence} between 0 and 100`),
    unique("lh_evidence_owner_id_id_unique").on(table.ownerId, table.id),
    foreignKey({
      name: "lh_evidence_owner_lead_leads_owner_id_id_fk",
      columns: [table.ownerId, table.leadId],
      foreignColumns: [leadHunterLeads.ownerId, leadHunterLeads.id],
    })
      .onDelete("cascade")
      .onUpdate("cascade"),
    index("lh_evidence_owner_lead_idx").on(table.ownerId, table.leadId),
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
    index("lh_enrollments_owner_campaign_status_idx").on(
      table.ownerId,
      table.campaignId,
      table.status,
    ),
    index("lh_enrollments_owner_next_action_idx").on(table.ownerId, table.nextActionAt),
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
