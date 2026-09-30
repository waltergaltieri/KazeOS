import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import * as schema from "@/db/schema";
import {
  leadHunterActivities,
  leadHunterCampaigns,
  leadHunterCampaignVersions,
  leadHunterContacts,
  leadHunterEnrollments,
  leadHunterEvidence,
  leadHunterJobs,
  leadHunterLeads,
  leadHunterRuns,
  leadHunterWebsiteAudits,
  type LeadHunterCampaignSnapshot,
} from "@/db/schema";
import { campaignStrategySchema, type CampaignStrategy } from "@/lib/leadhunter/contracts";
import {
  evaluateQualification,
  maximumQualificationEvidenceIds,
  qualificationCompletionEnvelopeSchema,
  qualificationResultSchema,
  type QualificationResult,
} from "@/lib/leadhunter/qualification";
import {
  deriveWebsiteAuditObservations,
  evaluateWebsiteAudit,
  websiteAuditEnvelopeSchema,
  type WebsiteAuditResult,
} from "@/lib/leadhunter/website-audit";
import {
  databaseDate,
  digestLeaseToken,
  exactDigestMatch,
  JobCompletionRejectedError,
  settleLeadHunterRun,
} from "./job-manager";
import {
  acquireLeadOutboundTransitionLock,
  getLeadOutboundProtection,
  type LeadOutboundProtection,
} from "./lead-manager";

export type LeadHunterQualificationTransaction = Pick<
  PostgresJsDatabase<typeof schema>,
  "execute"
>;

export interface LeadHunterQualificationDatabase {
  transaction<T>(
    operation: (database: LeadHunterQualificationTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface PersistQualificationJobInput {
  ownerId: string;
  jobId: string;
  leaseToken: string;
  now: Date;
  output: unknown;
}

export interface PersistWebsiteAuditJobResult {
  status: "processed" | "already_processed" | "rejected";
  auditId: string | null;
  gateResult: WebsiteAuditResult["gateResult"] | null;
}

export interface PersistQualificationJobResult {
  status: "processed" | "already_processed" | "rejected";
  decision: QualificationResult["decision"] | null;
  score: number | null;
  detail: QualificationResult | null;
}

interface LockedJobRow {
  id: string;
  runId: string;
  enrollmentId: string;
  leadId: string;
  campaignId: string;
  campaignVersion: number;
  currentCampaignVersion: number;
  state: "queued" | "leased" | "succeeded" | "failed" | "cancelled";
  kind: string;
  payload: unknown;
  result: unknown;
  leaseTokenDigest: string | null;
  leaseExpiresAt: Date | string | null;
  leaseOwner: string | null;
  evaluation: string;
  enrollmentStatus: string;
  leadStatus: string;
  snapshot: LeadHunterCampaignSnapshot;
  researchSummary: unknown;
  qualificationDetail: unknown;
  auditId: string | null;
  auditGateResult: string | null;
  auditConfidence: number | null;
  auditEvidenceIds: unknown;
  auditChecks: unknown;
  auditSummary: string | null;
  outboundProtection: LeadOutboundProtection;
}

type JobLeaseRow = Pick<
  LockedJobRow,
  | "id"
  | "runId"
  | "enrollmentId"
  | "leadId"
  | "state"
  | "kind"
  | "payload"
  | "result"
  | "leaseTokenDigest"
  | "leaseExpiresAt"
  | "leaseOwner"
>;

type EnrollmentContextRow = Pick<
  LockedJobRow,
  | "campaignId"
  | "campaignVersion"
  | "evaluation"
  | "enrollmentStatus"
  | "researchSummary"
  | "qualificationDetail"
>;

type LeadContextRow = Pick<LockedJobRow, "leadStatus">;
type CampaignVersionContextRow = Pick<
  LockedJobRow,
  "currentCampaignVersion" | "snapshot"
>;

interface EvidenceRow {
  id: string;
  questionKey: string | null;
  field: string;
  value: string;
  kind: "fact" | "hypothesis";
  status: "verified" | "inferred" | "conflicting";
  confidence: number;
  sourceUrl: string | null;
  sourceType: string;
  observedAt: Date | string;
}

interface ContactRow {
  emailConfidence: number;
}

interface AuditRow {
  id: string;
  gateResult: string;
  checks: unknown;
  summary: string;
  confidence: number;
  evidenceIds: unknown;
}

interface InsertedId {
  id: string;
}

const jobPayloadSchema = z.object({
  leadId: z.string().uuid(),
  website: z.string().url().max(2_048).refine(
    (value) => /^https?:\/\//i.test(value),
  ).nullable().optional(),
}).strict();

const storedAuditResultSchema = z.object({
  kind: z.literal("audit_website"),
  output: z.object({
    auditId: z.string().uuid(),
    gateResult: z.enum([
      "NO_WEBSITE",
      "BAD_WEBSITE",
      "GOOD_ENOUGH_WEBSITE",
      "UNVERIFIED",
    ]),
  }).strict(),
}).strict();

const storedQualificationResultSchema = z.object({
  kind: z.literal("qualify"),
  output: z.object({
    decision: z.enum(["eligible", "excluded", "needs_review", "no_email"]),
    score: z.number().int().min(0).max(100),
  }).strict(),
}).strict();

function stableUuid(parts: unknown[]): string {
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  const bytes = digest.slice(0, 32).split("");
  bytes[12] = "5";
  bytes[16] = ((Number.parseInt(bytes[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = bytes.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function lockJobContext(
  transaction: LeadHunterQualificationTransaction,
  input: PersistQualificationJobInput,
): Promise<LockedJobRow> {
  // Global business-state order: job, lead, owner/lead advisory lock,
  // outbound-protection re-read, enrollment, campaign/version, audit, run.
  const jobRows = await transaction.execute(sql<JobLeaseRow>`
    select
      job.id,
      job.run_id as "runId",
      job.enrollment_id as "enrollmentId",
      job.lead_id as "leadId",
      job.state,
      job.kind,
      job.payload,
      job.result,
      job.lease_token_digest as "leaseTokenDigest",
      job.lease_expires_at as "leaseExpiresAt",
      job.lease_owner as "leaseOwner"
    from ${leadHunterJobs} as job
    where job.owner_id = ${input.ownerId}
      and job.id = ${input.jobId}
    for update of job
  `) as unknown as JobLeaseRow[];
  const job = jobRows[0];
  const suppliedDigest = digestLeaseToken(input.leaseToken);
  if (!job || !exactDigestMatch(job.leaseTokenDigest, suppliedDigest)) {
    throw new JobCompletionRejectedError();
  }
  if (job.state !== "succeeded") {
    let activeLease = false;
    if (
      !Number.isNaN(input.now.getTime())
      && job.state === "leased"
      && job.leaseOwner === "worker-api"
      && job.leaseExpiresAt !== null
    ) {
      try {
        activeLease = databaseDate(job.leaseExpiresAt).getTime() > input.now.getTime();
      } catch {
        activeLease = false;
      }
    }
    if (!activeLease) throw new JobCompletionRejectedError();
  }

  const leadRows = await transaction.execute(sql<LeadContextRow>`
    select lead.status as "leadStatus"
    from ${leadHunterLeads} as lead
    where lead.owner_id = ${input.ownerId}
      and lead.id = ${job.leadId}
    for update of lead
  `) as unknown as LeadContextRow[];
  const lead = leadRows[0];
  if (!lead) throw new Error("Qualification lead provenance is invalid");

  await acquireLeadOutboundTransitionLock(transaction, input.ownerId, job.leadId);
  const outboundProtection = await getLeadOutboundProtection(
    transaction,
    input.ownerId,
    job.leadId,
  );

  const enrollmentRows = await transaction.execute(sql<EnrollmentContextRow>`
    select
      enrollment.campaign_id as "campaignId",
      enrollment.campaign_version as "campaignVersion",
      enrollment.evaluation,
      enrollment.status as "enrollmentStatus",
      enrollment.research_summary as "researchSummary",
      enrollment.qualification_detail as "qualificationDetail"
    from ${leadHunterEnrollments} as enrollment
    inner join ${leadHunterRuns} as run
      on run.owner_id = enrollment.owner_id
     and run.id = ${job.runId}
     and run.campaign_id = enrollment.campaign_id
     and run.campaign_version = enrollment.campaign_version
    where enrollment.owner_id = ${input.ownerId}
      and enrollment.id = ${job.enrollmentId}
      and enrollment.lead_id = ${job.leadId}
    for update of enrollment
  `) as unknown as EnrollmentContextRow[];
  const enrollment = enrollmentRows[0];
  if (!enrollment) throw new Error("Qualification enrollment provenance is invalid");

  const campaignRows = await transaction.execute(sql<CampaignVersionContextRow>`
    select
      campaign.config_version as "currentCampaignVersion",
      version.snapshot
    from ${leadHunterCampaigns} as campaign
    inner join ${leadHunterCampaignVersions} as version
      on version.owner_id = campaign.owner_id
     and version.campaign_id = campaign.id
     and version.version = ${enrollment.campaignVersion}
    where campaign.owner_id = ${input.ownerId}
      and campaign.id = ${enrollment.campaignId}
    for update of campaign, version
  `) as unknown as CampaignVersionContextRow[];
  const campaign = campaignRows[0];
  if (!campaign) throw new Error("Qualification campaign version provenance is invalid");

  return {
    ...job,
    ...enrollment,
    ...lead,
    ...campaign,
    auditId: null,
    auditGateResult: null,
    auditConfidence: null,
    auditEvidenceIds: null,
    auditChecks: null,
    auditSummary: null,
    outboundProtection,
  };
}

async function lockAuditForOwner(
  transaction: LeadHunterQualificationTransaction,
  ownerId: string,
  job: LockedJobRow,
): Promise<AuditRow | null> {
  const rows = await transaction.execute(sql<AuditRow>`
    select
      ${leadHunterWebsiteAudits.id},
      ${leadHunterWebsiteAudits.gateResult} as "gateResult",
      ${leadHunterWebsiteAudits.checks},
      ${leadHunterWebsiteAudits.summary},
      ${leadHunterWebsiteAudits.confidence},
      ${leadHunterWebsiteAudits.evidenceIds} as "evidenceIds"
    from ${leadHunterWebsiteAudits}
    where ${leadHunterWebsiteAudits.ownerId} = ${ownerId}
      and ${leadHunterWebsiteAudits.runId} = ${job.runId}
      and ${leadHunterWebsiteAudits.enrollmentId} = ${job.enrollmentId}
      and ${leadHunterWebsiteAudits.leadId} = ${job.leadId}
    for update
  `) as unknown as AuditRow[];
  return rows[0] ?? null;
}

async function readEvidence(
  transaction: LeadHunterQualificationTransaction,
  ownerId: string,
  job: LockedJobRow,
): Promise<EvidenceRow[]> {
  return transaction.execute(sql<EvidenceRow>`
    select
      ${leadHunterEvidence.id},
      ${leadHunterEvidence.questionKey} as "questionKey",
      ${leadHunterEvidence.field},
      ${leadHunterEvidence.value},
      ${leadHunterEvidence.kind},
      ${leadHunterEvidence.status},
      ${leadHunterEvidence.confidence},
      ${leadHunterEvidence.sourceUrl} as "sourceUrl",
      ${leadHunterEvidence.sourceType} as "sourceType",
      ${leadHunterEvidence.observedAt} as "observedAt"
    from ${leadHunterEvidence}
    where ${leadHunterEvidence.ownerId} = ${ownerId}
      and ${leadHunterEvidence.leadId} = ${job.leadId}
      and ${leadHunterEvidence.runId} = ${job.runId}
      and ${leadHunterEvidence.campaignId} = ${job.campaignId}
      and ${leadHunterEvidence.campaignVersion} = ${job.campaignVersion}
    order by ${leadHunterEvidence.id}
  `) as unknown as EvidenceRow[];
}

async function recordActivity(
  transaction: LeadHunterQualificationTransaction,
  input: {
    id: string;
    ownerId: string;
    campaignId: string;
    leadId: string;
    eventType: string;
    detail: Record<string, unknown>;
  },
) {
  await transaction.execute(sql`
    insert into ${leadHunterActivities} (
      id, owner_id, campaign_id, lead_id, actor_type, event_type, detail
    ) values (
      ${input.id}, ${input.ownerId}, ${input.campaignId}, ${input.leadId},
      'agent', ${input.eventType}, ${JSON.stringify(input.detail)}::jsonb
    )
    on conflict (id) do nothing
  `);
}

async function rejectOutput(
  transaction: LeadHunterQualificationTransaction,
  input: PersistQualificationJobInput,
  job: LockedJobRow,
  rejectionCode: string,
) {
  await recordActivity(transaction, {
    id: stableUuid([input.ownerId, input.jobId, job.kind, "rejected"]),
    ownerId: input.ownerId,
    campaignId: job.campaignId,
    leadId: job.leadId,
    eventType: `${job.kind}.rejected`,
    detail: { jobId: input.jobId, rejectionCode },
  });
  await transaction.execute(sql`
    update ${leadHunterJobs}
    set
      state = 'failed',
      result = null,
      lease_owner = null,
      lease_token_digest = null,
      lease_expires_at = null,
      last_error = ${`${job.kind}_output_rejected`}
    where ${leadHunterJobs.ownerId} = ${input.ownerId}
      and ${leadHunterJobs.id} = ${input.jobId}
      and ${leadHunterJobs.state} = 'leased'
  `);
  await settleLeadHunterRun(transaction, job.runId, input.now);
}

function provenanceIsCurrent(job: LockedJobRow): boolean {
  const payload = jobPayloadSchema.safeParse(job.payload);
  return payload.success
    && payload.data.leadId === job.leadId
    && job.currentCampaignVersion === job.campaignVersion;
}

async function persistDerivedAuditEvidence(
  transaction: LeadHunterQualificationTransaction,
  ownerId: string,
  job: LockedJobRow,
  evidence: ReturnType<typeof deriveWebsiteAuditObservations>["evidence"],
) {
  for (const row of evidence) {
    const contentHash = createHash("sha256").update(JSON.stringify({
      field: row.field,
      value: row.value,
      source: row.source,
      observedAt: row.observedAt,
    })).digest("hex");
    await transaction.execute(sql`
      insert into ${leadHunterEvidence} (
        id, owner_id, lead_id, run_id, campaign_id, campaign_version,
        question_key, kind, status, source_type, source_url, field, value,
        content_hash, confidence, observed_at
      ) values (
        ${row.id}, ${ownerId}, ${job.leadId}, ${job.runId}, ${job.campaignId},
        ${job.campaignVersion}, null, 'fact', 'verified',
        ${row.source.sourceType}, ${row.source.sourceUrl}, ${row.field},
        ${row.value}, ${contentHash}, ${row.confidence}, ${row.observedAt}::timestamptz
      )
      on conflict (id) do nothing
    `);
  }
}

export async function persistWebsiteAuditResult(
  database: LeadHunterQualificationDatabase,
  input: PersistQualificationJobInput,
): Promise<PersistWebsiteAuditJobResult> {
  return database.transaction((transaction) =>
    persistWebsiteAuditResultInTransaction(transaction, input));
}

export async function persistWebsiteAuditResultInTransaction(
  transaction: LeadHunterQualificationTransaction,
  input: PersistQualificationJobInput,
): Promise<PersistWebsiteAuditJobResult> {
    const job = await lockJobContext(transaction, input);
    if (job.kind !== "audit_website") throw new Error("Job is not a website audit job");
    if (job.state === "succeeded") {
      const stored = storedAuditResultSchema.safeParse(job.result);
      if (!stored.success) throw new Error("Stored website audit result is invalid");
      return {
        status: "already_processed",
        auditId: stored.data.output.auditId,
        gateResult: stored.data.output.gateResult,
      };
    }

    await lockAuditForOwner(transaction, input.ownerId, job);
    if (!provenanceIsCurrent(job)) {
      await rejectOutput(transaction, input, job, "stale_or_invalid_provenance");
      return { status: "rejected", auditId: null, gateResult: null };
    }
    const envelope = websiteAuditEnvelopeSchema.safeParse(input.output);
    if (!envelope.success) {
      await rejectOutput(transaction, input, job, "invalid_envelope");
      return { status: "rejected", auditId: null, gateResult: null };
    }
    const payload = jobPayloadSchema.parse(job.payload);
    let derived: ReturnType<typeof deriveWebsiteAuditObservations>;
    let audit: WebsiteAuditResult;
    try {
      derived = deriveWebsiteAuditObservations(envelope.data.observations, {
        namespace: [input.ownerId, job.runId, job.enrollmentId, job.id].join(":"),
        website: payload.website ?? null,
      });
      audit = evaluateWebsiteAudit(derived.checks, {
        website: payload.website,
        allowedWebsiteOrigins: derived.allowedWebsiteOrigins,
        contextEvidenceIds: derived.contextEvidenceIds,
      });
    } catch {
      await rejectOutput(transaction, input, job, "invalid_observation_provenance");
      return { status: "rejected", auditId: null, gateResult: null };
    }
    await persistDerivedAuditEvidence(transaction, input.ownerId, job, derived.evidence);
    const deterministicAuditId = stableUuid([
      input.ownerId, job.runId, job.enrollmentId, "website-audit",
    ]);
    const inserted = await transaction.execute(sql<InsertedId>`
      insert into ${leadHunterWebsiteAudits} (
        id, owner_id, run_id, enrollment_id, lead_id, gate_result,
        checks, summary, confidence, evidence_ids
      ) values (
        ${deterministicAuditId}, ${input.ownerId}, ${job.runId},
        ${job.enrollmentId}, ${job.leadId}, ${audit.gateResult},
        ${JSON.stringify(audit.checks)}::jsonb, ${audit.summary},
        ${audit.confidence}, ${JSON.stringify(audit.evidenceIds)}::jsonb
      )
      on conflict (owner_id, run_id, enrollment_id) do nothing
      returning ${leadHunterWebsiteAudits.id}
    `) as unknown as InsertedId[];
    const existingAudit = inserted[0]
      ? null
      : await lockAuditForOwner(transaction, input.ownerId, job);
    const persistedAudit = inserted[0] ?? existingAudit;
    if (!persistedAudit) throw new Error("Website audit persistence did not return a row");
    const auditId = persistedAudit.id;
    const persistedGateResult = existingAudit
      ? storedAuditForQualification(existingAudit)?.gateResult
      : audit.gateResult;
    if (!persistedGateResult) throw new Error("Stored website audit is invalid");
    const result = {
      kind: "audit_website",
      output: { auditId, gateResult: persistedGateResult },
    } as const;
    await recordActivity(transaction, {
      id: stableUuid([input.ownerId, input.jobId, "audit_website", "completed"]),
      ownerId: input.ownerId,
      campaignId: job.campaignId,
      leadId: job.leadId,
      eventType: "audit_website.completed",
      detail: {
        jobId: input.jobId,
        auditId,
        gateResult: persistedGateResult,
        confidence: audit.confidence,
        reasons: audit.reasons,
        evidenceIds: audit.evidenceIds,
      },
    });
    await transaction.execute(sql`
      update ${leadHunterJobs}
      set
        state = 'succeeded',
        result = ${JSON.stringify(result)}::jsonb,
        lease_owner = null,
        lease_expires_at = null,
        last_error = null
      where ${leadHunterJobs.ownerId} = ${input.ownerId}
        and ${leadHunterJobs.id} = ${input.jobId}
        and ${leadHunterJobs.state} = 'leased'
    `);
    await settleLeadHunterRun(transaction, job.runId, input.now);
    return { status: "processed", auditId, gateResult: persistedGateResult };
}

function strategyFromSnapshot(snapshot: LeadHunterCampaignSnapshot): CampaignStrategy {
  return campaignStrategySchema.parse(snapshot.strategy);
}

function storedAuditForQualification(
  audit: AuditRow | null,
): { gateResult: WebsiteAuditResult["gateResult"]; confidence: number; evidenceIds: string[] } | null {
  if (!audit) return null;
  const parsed = z.object({
    gateResult: z.enum([
      "NO_WEBSITE", "BAD_WEBSITE", "GOOD_ENOUGH_WEBSITE", "UNVERIFIED",
    ]),
    confidence: z.number().int().min(0).max(100),
    evidenceIds: z.array(z.string().uuid()).max(maximumQualificationEvidenceIds),
  }).strict().parse({
    gateResult: audit.gateResult,
    confidence: audit.confidence,
    evidenceIds: audit.evidenceIds,
  });
  return parsed;
}

export async function persistQualificationResult(
  database: LeadHunterQualificationDatabase,
  input: PersistQualificationJobInput,
): Promise<PersistQualificationJobResult> {
  return database.transaction((transaction) =>
    persistQualificationResultInTransaction(transaction, input));
}

export async function persistQualificationResultInTransaction(
  transaction: LeadHunterQualificationTransaction,
  input: PersistQualificationJobInput,
): Promise<PersistQualificationJobResult> {
    const job = await lockJobContext(transaction, input);
    if (job.kind !== "qualify") throw new Error("Job is not a qualification job");
    if (job.state === "succeeded") {
      const stored = storedQualificationResultSchema.safeParse(job.result);
      const detail = qualificationResultSchema.safeParse(job.qualificationDetail);
      if (!stored.success || !detail.success) {
        throw new Error("Stored qualification result is invalid");
      }
      return {
        status: "already_processed",
        decision: stored.data.output.decision,
        score: stored.data.output.score,
        detail: detail.data,
      };
    }

    const audit = await lockAuditForOwner(transaction, input.ownerId, job);
    if (!provenanceIsCurrent(job)) {
      await rejectOutput(transaction, input, job, "stale_or_invalid_provenance");
      return { status: "rejected", decision: null, score: null, detail: null };
    }
    const envelope = qualificationCompletionEnvelopeSchema.safeParse(input.output);
    if (!envelope.success) {
      await rejectOutput(transaction, input, job, "invalid_envelope");
      return { status: "rejected", decision: null, score: null, detail: null };
    }
    const evidence = await readEvidence(transaction, input.ownerId, job);
    const contacts = await transaction.execute(sql<ContactRow>`
      select ${leadHunterContacts.emailConfidence} as "emailConfidence"
      from ${leadHunterContacts}
      where ${leadHunterContacts.ownerId} = ${input.ownerId}
        and ${leadHunterContacts.leadId} = ${job.leadId}
        and ${leadHunterContacts.normalizedEmail} is not null
        and ${leadHunterContacts.sourceUrl} is not null
        and ${leadHunterContacts.sourceType} is not null
        and ${leadHunterContacts.verifiedAt} is not null
        and ${leadHunterContacts.emailConfidence} >= 75
      order by ${leadHunterContacts.emailConfidence} desc, ${leadHunterContacts.id}
      limit 1
    `) as unknown as ContactRow[];
    const strategy = strategyFromSnapshot(job.snapshot);
    let detail: QualificationResult;
    try {
      detail = qualificationResultSchema.parse(evaluateQualification({
        gates: strategy.qualification.gates,
        rules: strategy.qualification.rules,
        researchQuestions: strategy.research.questions,
        evidence: evidence.map((row) => ({
          id: row.id,
          questionKey: row.questionKey,
          field: row.field,
          value: row.value,
          kind: row.kind,
          status: row.status,
          confidence: row.confidence,
          sourceType: row.sourceType,
          sourceUrl: row.sourceUrl,
        })),
        websiteAudit: storedAuditForQualification(audit),
        publishedEmailConfidence: contacts[0]?.emailConfidence ?? null,
      }));
    } catch {
      await rejectOutput(transaction, input, job, "invalid_qualification_evidence");
      return { status: "rejected", decision: null, score: null, detail: null };
    }

    const enrollmentStatus = job.outboundProtection.blocked || detail.decision === "excluded"
      ? "stopped"
      : "researching";
    const protectionReason = job.outboundProtection.blocked
      ? `outbound_blocked:${job.outboundProtection.reason}`
      : null;
    const reason = [...detail.reasons, ...(protectionReason ? [protectionReason] : [])]
      .join("; ").slice(0, 2_000) || "qualification_completed";
    await transaction.execute(sql`
      update ${leadHunterEnrollments}
      set
        evaluation = ${detail.decision}::lh_evaluation,
        status = ${enrollmentStatus}::lh_enrollment_status,
        score = ${detail.score},
        reason = ${reason},
        qualification_detail = ${JSON.stringify(detail)}::jsonb
      where ${leadHunterEnrollments.ownerId} = ${input.ownerId}
        and ${leadHunterEnrollments.id} = ${job.enrollmentId}
        and ${leadHunterEnrollments.leadId} = ${job.leadId}
        and ${leadHunterEnrollments.campaignId} = ${job.campaignId}
        and ${leadHunterEnrollments.campaignVersion} = ${job.campaignVersion}
    `);
    if (
      !job.outboundProtection.blocked
      && (detail.decision === "eligible" || detail.decision === "no_email")
    ) {
      await transaction.execute(sql`
        update ${leadHunterLeads}
        set status = 'qualified'
        where ${leadHunterLeads.ownerId} = ${input.ownerId}
          and ${leadHunterLeads.id} = ${job.leadId}
          and ${leadHunterLeads.status} in ('new', 'researching')
      `);
    }
    await recordActivity(transaction, {
      id: stableUuid([input.ownerId, input.jobId, "qualify", "completed"]),
      ownerId: input.ownerId,
      campaignId: job.campaignId,
      leadId: job.leadId,
      eventType: "qualify.completed",
      detail: {
        jobId: input.jobId,
        enrollmentId: job.enrollmentId,
        enrollmentStatus,
        outboundBlocked: job.outboundProtection.blocked,
        outboundBlockReason: job.outboundProtection.reason,
        ...detail,
      },
    });
    const result = {
      kind: "qualify",
      output: { decision: detail.decision, score: detail.score },
    } as const;
    await transaction.execute(sql`
      update ${leadHunterJobs}
      set
        state = 'succeeded',
        result = ${JSON.stringify(result)}::jsonb,
        lease_owner = null,
        lease_expires_at = null,
        last_error = null
      where ${leadHunterJobs.ownerId} = ${input.ownerId}
        and ${leadHunterJobs.id} = ${input.jobId}
        and ${leadHunterJobs.state} = 'leased'
    `);
    await settleLeadHunterRun(transaction, job.runId, input.now);
    return {
      status: "processed",
      decision: detail.decision,
      score: detail.score,
      detail,
    };
}
