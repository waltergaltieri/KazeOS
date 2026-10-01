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

interface CompletionDispatchRow {
  ownerId: string;
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
    if (job.kind === "research") {
      return persistResearchResultInTransaction(database, managerInput);
    }
    if (job.kind === "audit_website") {
      return persistWebsiteAuditResultInTransaction(database, managerInput);
    }
    if (job.kind === "qualify") {
      return persistQualificationResultInTransaction(database, managerInput);
    }
    return persistContactEnrichmentResultInTransaction(database, managerInput);
  }

  return completeJob(database, input);
}
