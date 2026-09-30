import "server-only";

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/db/schema";
import {
  leadHunterJobs,
  leadHunterSourceCandidates,
} from "@/db/schema";
import type {
  SearchPlanWorkItem,
  SourceAdapterId,
  SourceCandidate,
  SourceDiscoveryPage,
  SourceResultCursor,
} from "@/lib/leadhunter/sources/contracts";

export type LeadHunterDiscoveryDatabase = Pick<
  PostgresJsDatabase<typeof schema>,
  "execute"
>;

export interface PersistDiscoveryPageInput {
  ownerId: string;
  runId: string;
  work: SearchPlanWorkItem;
  page: SourceDiscoveryPage;
}

export interface PersistDiscoveryPageResult {
  storedCandidates: number;
  scheduledIdentityJobs: number;
  nextCursor: SourceResultCursor;
}

interface InsertedRow {
  id: string;
}

function sourceTypeForWork(work: SearchPlanWorkItem): SourceAdapterId {
  return work.kind === "seed_url" ? "seed_url" : work.source;
}

function queryForWork(work: SearchPlanWorkItem): string {
  return work.kind === "seed_url" ? work.url : work.query;
}

function assertCandidate(candidate: SourceCandidate, expectedSource: SourceAdapterId): void {
  if (candidate.sourceType !== expectedSource) {
    throw new TypeError("Discovery candidate source does not match its work item");
  }
  if (!candidate.sourceIdentity.trim()) {
    throw new TypeError("Discovery candidate source identity must not be blank");
  }
  if (!candidate.sourceUrl || !candidate.observedUrl || !candidate.canonicalUrl) {
    throw new TypeError("Discovery candidate URLs must not be blank");
  }
  if (!Number.isSafeInteger(candidate.providerRank) || candidate.providerRank < 1) {
    throw new TypeError("Discovery candidate provider rank must be a positive integer");
  }
}

export async function persistDiscoveryPage(
  database: LeadHunterDiscoveryDatabase,
  input: PersistDiscoveryPageInput,
): Promise<PersistDiscoveryPageResult> {
  const sourceType = sourceTypeForWork(input.work);
  const query = queryForWork(input.work);
  const uniqueCandidates: SourceCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of input.page.candidates) {
    assertCandidate(candidate, sourceType);
    const identity = `${candidate.sourceType}\u0000${candidate.sourceIdentity}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    uniqueCandidates.push(candidate);
  }

  const insertedCandidates: string[] = [];
  for (const candidate of uniqueCandidates) {
    const rawRecord = {
      sourceUrl: candidate.sourceUrl,
      observedUrl: candidate.observedUrl,
      providerRank: candidate.providerRank,
      observedName: candidate.observedName,
      observedLocation: candidate.observedLocation,
      metadata: candidate.metadata,
    };
    const stored = await database.execute(sql<InsertedRow>`
      insert into ${leadHunterSourceCandidates} (
        owner_id,
        run_id,
        source_type,
        source_identity,
        query,
        raw_record,
        canonical_url
      ) values (
        ${input.ownerId},
        ${input.runId},
        ${sourceType},
        ${candidate.sourceIdentity},
        ${query},
        ${JSON.stringify(rawRecord)}::jsonb,
        ${candidate.canonicalUrl}
      )
      on conflict (owner_id, run_id, source_type, source_identity) do nothing
      returning id
    `) as unknown as InsertedRow[];
    if (stored[0]) insertedCandidates.push(stored[0].id);
  }

  let scheduledIdentityJobs = 0;
  for (const candidateId of insertedCandidates) {
    const idempotencyKey = `run:${input.runId}:resolve_identity:${candidateId}`;
    const scheduled = await database.execute(sql<InsertedRow>`
      insert into ${leadHunterJobs} (
        owner_id,
        run_id,
        kind,
        payload,
        idempotency_key
      ) values (
        ${input.ownerId},
        ${input.runId},
        'resolve_identity',
        ${JSON.stringify({ candidateId })}::jsonb,
        ${idempotencyKey}
      )
      on conflict (owner_id, idempotency_key) do nothing
      returning id
    `) as unknown as InsertedRow[];
    if (scheduled[0]) scheduledIdentityJobs += 1;
  }

  return {
    storedCandidates: insertedCandidates.length,
    scheduledIdentityJobs,
    nextCursor: input.page.nextCursor,
  };
}
