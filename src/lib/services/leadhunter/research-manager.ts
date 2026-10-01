import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import * as schema from "@/db/schema";
import {
  leadHunterActivities,
  leadHunterEnrollments,
  leadHunterEvidence,
  leadHunterJobs,
} from "@/db/schema";
import { researchQuestionSchema } from "@/lib/leadhunter/contracts";
import {
  reduceResearchDossier,
  validateResearchWorkerOutput,
  type AcceptedResearchEvidence,
  type ResearchDossier,
} from "@/lib/leadhunter/research";
import {
  databaseDate,
  digestLeaseToken,
  exactDigestMatch,
  JobCompletionRejectedError,
  settleLeadHunterRun,
} from "./job-manager";

const sourceProvenanceSchema = z.object({
  sourceUrl: z.string().trim().url().max(2_048)
    .refine((value) => /^https?:\/\//i.test(value))
    .refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password;
    }),
  sourceType: z.string().trim().min(1).max(80),
  suppliedAt: z.string().datetime({ offset: true }),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

const researchPayloadSchema = z.object({
  leadId: z.string().uuid(),
  source: sourceProvenanceSchema,
  budget: z.object({
    maxRuntimeMs: z.number().int().min(50).max(120_000),
    maxModelCalls: z.number().int().min(0).max(10),
    maxInputTokens: z.number().int().min(0).max(200_000),
    maxOutputTokens: z.number().int().min(0).max(20_000),
    maxCostUsd: z.number().min(0).max(100),
  }).strict(),
  content: z.string().max(100_000).optional(),
  questions: z.array(researchQuestionSchema).max(100).optional(),
}).strict();

const storedResearchResultSchema = z.object({
  kind: z.literal("research"),
  output: z.object({ evidenceIds: z.array(z.string().uuid()).max(50) }).strict(),
}).strict();

export type LeadHunterResearchTransaction = Pick<
  PostgresJsDatabase<typeof schema>,
  "execute"
>;

export interface LeadHunterResearchDatabase {
  transaction<T>(
    operation: (database: LeadHunterResearchTransaction) => Promise<T>,
  ): Promise<T>;
}

interface ResearchJobRow {
  id: string;
  runId: string;
  enrollmentId: string;
  leadId: string;
  campaignId: string;
  campaignVersion: number;
  state: "queued" | "leased" | "succeeded" | "failed" | "cancelled";
  kind: string;
  payload: unknown;
  result: unknown;
  researchSummary: ResearchDossier | null;
  questions: unknown;
  leaseTokenDigest: string | null;
  leaseExpiresAt: Date | string | null;
  leaseOwner: string | null;
}

interface PersistedEvidenceRow {
  id: string;
  questionKey: string;
  field: string;
  value: string;
  status: AcceptedResearchEvidence["status"];
  confidence: number;
  sourceUrl: string;
  sourceType: string;
  suppliedAt: Date | string;
  extract: string | null;
  contentHash: string;
}

export interface PersistResearchResultInput {
  ownerId: string;
  jobId: string;
  leaseToken: string;
  now: Date;
  output: unknown;
}

export interface PersistResearchResultResult {
  status: "processed" | "already_processed" | "rejected";
  evidenceIds: string[];
  rejectedCount: number;
  dossier: ResearchDossier | null;
}

function stableUuid(parts: unknown[]): string {
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  const bytes = digest.slice(0, 32).split("");
  bytes[12] = "5";
  bytes[16] = ((Number.parseInt(bytes[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = bytes.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function recordResearchActivity(
  transaction: LeadHunterResearchTransaction,
  input: {
    activityId: string;
    ownerId: string;
    campaignId: string;
    leadId: string;
    eventType: "research.completed" | "research.rejected";
    detail: Record<string, unknown>;
  },
) {
  await transaction.execute(sql`
    insert into ${leadHunterActivities} (
      id,
      owner_id,
      campaign_id,
      lead_id,
      actor_type,
      event_type,
      detail
    ) values (
      ${input.activityId},
      ${input.ownerId},
      ${input.campaignId},
      ${input.leadId},
      'agent',
      ${input.eventType},
      ${JSON.stringify(input.detail)}::jsonb
    )
    on conflict (id) do nothing
  `);
}

export async function persistResearchResult(
  database: LeadHunterResearchDatabase,
  input: PersistResearchResultInput,
): Promise<PersistResearchResultResult> {
  return database.transaction((transaction) =>
    persistResearchResultInTransaction(transaction, input));
}

export async function persistResearchResultInTransaction(
  transaction: LeadHunterResearchTransaction,
  input: PersistResearchResultInput,
): Promise<PersistResearchResultResult> {
  const rows = await transaction.execute(sql<ResearchJobRow>`
      select
        job.id,
        job.run_id as "runId",
        job.enrollment_id as "enrollmentId",
        job.lead_id as "leadId",
        enrollment.campaign_id as "campaignId",
        enrollment.campaign_version as "campaignVersion",
        job.state,
        job.kind,
        job.payload,
        job.result,
        job.lease_token_digest as "leaseTokenDigest",
        job.lease_expires_at as "leaseExpiresAt",
        job.lease_owner as "leaseOwner",
        enrollment.research_summary as "researchSummary",
        version.snapshot->'strategy'->'research'->'questions' as questions
      from ${leadHunterJobs} as job
      inner join ${leadHunterEnrollments} as enrollment
        on enrollment.owner_id = job.owner_id
       and enrollment.id = job.enrollment_id
       and enrollment.lead_id = job.lead_id
      inner join lh_runs as run
        on run.owner_id = job.owner_id
       and run.id = job.run_id
       and run.campaign_id = enrollment.campaign_id
       and run.campaign_version = enrollment.campaign_version
      inner join lh_leads as lead
        on lead.owner_id = job.owner_id
       and lead.id = job.lead_id
      inner join lh_campaign_versions as version
        on version.owner_id = job.owner_id
       and version.campaign_id = enrollment.campaign_id
       and version.version = enrollment.campaign_version
      where job.owner_id = ${input.ownerId}
        and job.id = ${input.jobId}
      for update of job, enrollment
    `) as unknown as ResearchJobRow[];
    const job = rows[0];
    const suppliedDigest = digestLeaseToken(input.leaseToken);
    if (!job || !exactDigestMatch(job.leaseTokenDigest, suppliedDigest)) {
      throw new JobCompletionRejectedError();
    }
    if (job.kind !== "research") throw new Error("Job is not a research job");

    if (job.state === "succeeded") {
      const stored = storedResearchResultSchema.safeParse(job.result);
      if (!stored.success) throw new Error("Stored research result is invalid");
      return {
        status: "already_processed",
        evidenceIds: stored.data.output.evidenceIds,
        rejectedCount: 0,
        dossier: job.researchSummary,
      };
    }
    const trustedNow = input.now.getTime();
    let activeLease = false;
    if (
      !Number.isNaN(trustedNow)
      && job.state === "leased"
      && job.leaseOwner === "worker-api"
      && job.leaseExpiresAt !== null
    ) {
      try {
        activeLease = databaseDate(job.leaseExpiresAt).getTime() > trustedNow;
      } catch {
        activeLease = false;
      }
    }
    if (!activeLease) {
      throw new JobCompletionRejectedError();
    }

    const payload = researchPayloadSchema.safeParse(job.payload);
    if (!payload.success || payload.data.leadId !== job.leadId) {
      throw new Error("Research job provenance is invalid");
    }
    const questions = z.array(researchQuestionSchema).min(1).max(100).parse(job.questions);
    const validated = validateResearchWorkerOutput({
      ownerId: input.ownerId,
      leadId: job.leadId,
      campaignId: job.campaignId,
      campaignVersion: job.campaignVersion,
      questions,
      expectedSource: payload.data.source,
      expectedBudget: payload.data.budget,
    }, input.output);
    const activityId = stableUuid([
      input.ownerId,
      input.jobId,
      "research",
      payload.data.source.contentSha256,
    ]);

    if (validated.fatal) {
      await recordResearchActivity(transaction, {
        activityId,
        ownerId: input.ownerId,
        campaignId: job.campaignId,
        leadId: job.leadId,
        eventType: "research.rejected",
        detail: {
          jobId: input.jobId,
          acceptedCount: 0,
          rejected: validated.rejected,
          workerDiagnostics: validated.workerDiagnostics,
          usage: validated.usage,
        },
      });
      await transaction.execute(sql`
        update ${leadHunterJobs}
        set
          state = 'failed',
          result = null,
          lease_owner = null,
          lease_token_digest = null,
          lease_expires_at = null,
          last_error = 'research_output_rejected'
        where ${leadHunterJobs.ownerId} = ${input.ownerId}
          and ${leadHunterJobs.id} = ${input.jobId}
          and ${leadHunterJobs.state} = 'leased'
      `);
      await settleLeadHunterRun(transaction, job.runId, input.now);
      return {
        status: "rejected",
        evidenceIds: [],
        rejectedCount: validated.rejected.length,
        dossier: null,
      };
    }

    for (const evidence of validated.accepted) {
      const kind = evidence.status === "verified" ? "fact" : "hypothesis";
      await transaction.execute(sql`
        insert into ${leadHunterEvidence} (
          id,
          owner_id,
          lead_id,
          run_id,
          campaign_id,
          campaign_version,
          question_key,
          kind,
          status,
          source_type,
          source_url,
          field,
          value,
          extract,
          content_hash,
          confidence,
          observed_at
        ) values (
          ${evidence.id},
          ${input.ownerId},
          ${job.leadId},
          ${job.runId},
          ${job.campaignId},
          ${job.campaignVersion},
          ${evidence.questionKey},
          ${kind}::lh_evidence_kind,
          ${evidence.status}::lh_evidence_status,
          ${evidence.sourceType},
          ${evidence.sourceUrl},
          ${evidence.field},
          ${evidence.value},
          ${evidence.extract},
          ${evidence.contentHash},
          ${evidence.confidence},
          ${evidence.suppliedAt}::timestamptz
        )
        on conflict (id) do nothing
      `);
    }

    const persistedRows = await transaction.execute(sql<PersistedEvidenceRow>`
      select
        ${leadHunterEvidence.id},
        ${leadHunterEvidence.questionKey} as "questionKey",
        ${leadHunterEvidence.field},
        ${leadHunterEvidence.value},
        ${leadHunterEvidence.status},
        ${leadHunterEvidence.confidence},
        ${leadHunterEvidence.sourceUrl} as "sourceUrl",
        ${leadHunterEvidence.sourceType} as "sourceType",
        ${leadHunterEvidence.observedAt} as "suppliedAt",
        ${leadHunterEvidence.extract},
        ${leadHunterEvidence.contentHash} as "contentHash"
      from ${leadHunterEvidence}
      where ${leadHunterEvidence.ownerId} = ${input.ownerId}
        and ${leadHunterEvidence.leadId} = ${job.leadId}
        and ${leadHunterEvidence.campaignId} = ${job.campaignId}
        and ${leadHunterEvidence.campaignVersion} = ${job.campaignVersion}
        and ${leadHunterEvidence.questionKey} is not null
        and ${leadHunterEvidence.sourceUrl} is not null
        and ${leadHunterEvidence.contentHash} is not null
      order by ${leadHunterEvidence.id}
    `) as unknown as PersistedEvidenceRow[];
    const dossierEvidence = new Map<string, AcceptedResearchEvidence>();
    for (const evidence of persistedRows) {
      dossierEvidence.set(evidence.id, {
        ...evidence,
        normalizedSourceUrl: evidence.sourceUrl,
        suppliedAt: new Date(evidence.suppliedAt).toISOString(),
      });
    }
    for (const evidence of validated.accepted) dossierEvidence.set(evidence.id, evidence);
    const dossier = reduceResearchDossier(questions, [...dossierEvidence.values()]);
    const evidenceIds = validated.accepted.map(({ id }) => id);
    const result = { kind: "research", output: { evidenceIds } } as const;
    await transaction.execute(sql`
      update ${leadHunterEnrollments}
      set research_summary = ${JSON.stringify(dossier)}::jsonb
      where ${leadHunterEnrollments.ownerId} = ${input.ownerId}
        and ${leadHunterEnrollments.id} = ${job.enrollmentId}
        and ${leadHunterEnrollments.leadId} = ${job.leadId}
        and ${leadHunterEnrollments.campaignId} = ${job.campaignId}
        and ${leadHunterEnrollments.campaignVersion} = ${job.campaignVersion}
    `);
    await recordResearchActivity(transaction, {
      activityId,
      ownerId: input.ownerId,
      campaignId: job.campaignId,
      leadId: job.leadId,
      eventType: "research.completed",
      detail: {
        jobId: input.jobId,
        acceptedCount: evidenceIds.length,
        rejected: validated.rejected,
        workerDiagnostics: validated.workerDiagnostics,
        usage: validated.usage,
        evidenceIds,
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

  return {
    status: "processed",
    evidenceIds,
    rejectedCount: validated.rejected.length,
    dossier,
  };
}
