import "server-only";

import { sql } from "drizzle-orm";

import { leadHunterJobs } from "@/db/schema";
import {
  completeJob,
  type CompleteJobInput,
  databaseDate,
  digestLeaseToken,
  exactDigestMatch,
  JobCompletionRejectedError,
  type LeadHunterJobDatabase,
} from "./job-manager";
import { persistResearchResultInTransaction } from "./research-manager";
import {
  persistQualificationResultInTransaction,
  persistWebsiteAuditResultInTransaction,
} from "./qualification-manager";
import { persistContactEnrichmentResultInTransaction } from "./contact-manager";
import { advancePipelineAfterResult } from "./pipeline-manager";
import { prepareValidatedMessage } from "./message-manager";

interface CompletionDispatchRow {
  ownerId: string;
  runId: string;
  enrollmentId: string | null;
  leadId: string | null;
  kind: string;
  state: string;
  leaseOwner: string | null;
  leaseTokenDigest: string | null;
  leaseExpiresAt: Date | string | null;
}

export async function completeClaimedJob(
  database: LeadHunterJobDatabase,
  input: CompleteJobInput,
) {
  const rows = await database.execute(sql<CompletionDispatchRow>`
    select
      ${leadHunterJobs.ownerId} as "ownerId",
      ${leadHunterJobs.runId} as "runId",
      ${leadHunterJobs.enrollmentId} as "enrollmentId",
      ${leadHunterJobs.leadId} as "leadId",
      ${leadHunterJobs.kind},
      ${leadHunterJobs.state},
      ${leadHunterJobs.leaseOwner} as "leaseOwner",
      ${leadHunterJobs.leaseTokenDigest} as "leaseTokenDigest",
      ${leadHunterJobs.leaseExpiresAt} as "leaseExpiresAt"
    from ${leadHunterJobs}
    where ${leadHunterJobs.id} = ${input.id}
  `) as unknown as CompletionDispatchRow[];
  const job = rows[0];

  if (
    job
    && ["research", "audit_website", "qualify", "enrich_contact"].includes(job.kind)
    && "result" in input.completion
  ) {
    const suppliedDigest = digestLeaseToken(input.leaseToken);
    if (!exactDigestMatch(job.leaseTokenDigest, suppliedDigest)) {
      throw new JobCompletionRejectedError();
    }
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
    if (!activeLease && job.state !== "succeeded") {
      throw new JobCompletionRejectedError();
    }
    const managerInput = {
      ownerId: job.ownerId,
      jobId: input.id,
      leaseToken: input.leaseToken,
      now: input.now,
      output: input.completion.result,
    };
    let result: Record<string, unknown>;
    if (job.kind === "research") result = await persistResearchResultInTransaction(database, managerInput) as unknown as Record<string, unknown>;
    else if (job.kind === "audit_website") result = await persistWebsiteAuditResultInTransaction(database, managerInput) as unknown as Record<string, unknown>;
    else if (job.kind === "qualify") result = await persistQualificationResultInTransaction(database, managerInput) as unknown as Record<string, unknown>;
    else result = await persistContactEnrichmentResultInTransaction(database, managerInput) as unknown as Record<string, unknown>;
    const output = job.kind === "research" ? { evidenceIds: result.evidenceIds }
      : job.kind === "audit_website" ? { auditId: result.auditId, gateResult: result.gateResult }
      : job.kind === "qualify" ? { decision: result.decision, score: result.score }
      : { outcome: result.outcome, primaryContactId: result.primaryContactId, outboundBlocked: result.outboundBlocked };
    if (job.kind !== "enrich_contact") {
      await advancePipelineAfterResult(database, { ownerId: job.ownerId, runId: job.runId, enrollmentId: job.enrollmentId, leadId: job.leadId, kind: job.kind as "research" | "audit_website" | "qualify" }, output);
    }
    if (job.kind === "enrich_contact" && output.outcome === "selected" && !output.outboundBlocked && job.enrollmentId) {
      await prepareValidatedMessage(database, job.ownerId, job.enrollmentId, input.now);
    }
    return result;
  }

  return completeJob(database, input);
}
