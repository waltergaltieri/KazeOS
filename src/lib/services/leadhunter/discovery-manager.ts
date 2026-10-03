import "server-only";

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/db/schema";
import {
  leadHunterJobs,
  leadHunterRuns,
  leadHunterSourceCandidates,
} from "@/db/schema";
import type {
  SearchPlanWorkItem,
  SourceAdapterId,
  SourceCandidate,
  SourceDiscoveryPage,
  SourceResultCursor,
} from "@/lib/leadhunter/sources/contracts";

export type LeadHunterDiscoveryTransaction = Pick<
  PostgresJsDatabase<typeof schema>,
  "execute"
>;

export interface LeadHunterDiscoveryDatabase {
  transaction<T>(
    operation: (database: LeadHunterDiscoveryTransaction) => Promise<T>,
  ): Promise<T>;
}

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

interface CandidateBudgetRow {
  maxCandidates: number;
  existingCandidates: number;
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
  return database.transaction((transaction) =>
    persistDiscoveryPageInTransaction(transaction, input));
}

export async function persistDiscoveryPageInTransaction(
  database: LeadHunterDiscoveryTransaction,
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

  const budgetRows = await database.execute(sql<CandidateBudgetRow>`
    select
      (${leadHunterRuns.plan}->'budget'->>'maxCandidates')::integer as "maxCandidates",
      (
        select count(*)::integer
        from ${leadHunterSourceCandidates} existing
        where existing.owner_id = ${input.ownerId}
          and existing.run_id = ${input.runId}
      ) as "existingCandidates"
    from ${leadHunterRuns}
    where ${leadHunterRuns.ownerId} = ${input.ownerId}
      and ${leadHunterRuns.id} = ${input.runId}
    for update of ${leadHunterRuns}
  `) as unknown as CandidateBudgetRow[];
  const budget = budgetRows[0];
  if (
    !budget
    || !Number.isSafeInteger(budget.maxCandidates)
    || budget.maxCandidates < 0
    || !Number.isSafeInteger(budget.existingCandidates)
    || budget.existingCandidates < 0
  ) {
    throw new Error("Discovery candidate budget is invalid");
  }
  let remainingCandidates = Math.max(
    0,
    budget.maxCandidates - budget.existingCandidates,
  );

  const persistedCandidates: Array<{ id: string; inserted: boolean }> = [];
  for (const candidate of uniqueCandidates) {
      const rawRecord = {
        sourceUrl: candidate.sourceUrl,
        observedUrl: candidate.observedUrl,
        providerRank: candidate.providerRank,
        observedName: candidate.observedName,
        observedLocation: candidate.observedLocation,
        metadata: candidate.metadata,
      };
      const inserted = remainingCandidates > 0
        ? await database.execute(sql<InsertedRow>`
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
      `) as unknown as InsertedRow[]
        : [];

      if (inserted[0]) {
        persistedCandidates.push({ id: inserted[0].id, inserted: true });
        remainingCandidates -= 1;
        continue;
      }

      const existing = await database.execute(sql<InsertedRow>`
        select ${leadHunterSourceCandidates.id}
        from ${leadHunterSourceCandidates}
        where ${leadHunterSourceCandidates.ownerId} = ${input.ownerId}
          and ${leadHunterSourceCandidates.runId} = ${input.runId}
          and ${leadHunterSourceCandidates.sourceType} = ${sourceType}
          and ${leadHunterSourceCandidates.sourceIdentity} = ${candidate.sourceIdentity}
        limit 1
      `) as unknown as InsertedRow[];
      if (!existing[0] && remainingCandidates > 0) {
        throw new Error("Source candidate conflict could not be resolved");
      }
      if (existing[0]) {
        persistedCandidates.push({ id: existing[0].id, inserted: false });
      }
  }

  let scheduledIdentityJobs = 0;
  for (const candidate of persistedCandidates) {
      const idempotencyKey = `run:${input.runId}:resolve_identity:${candidate.id}`;
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
          ${JSON.stringify({ candidateId: candidate.id })}::jsonb,
          ${idempotencyKey}
        )
        on conflict (owner_id, idempotency_key) do nothing
        returning id
      `) as unknown as InsertedRow[];
    if (scheduled[0]) scheduledIdentityJobs += 1;
  }

  return {
    storedCandidates: persistedCandidates.filter(({ inserted }) => inserted).length,
    scheduledIdentityJobs,
    nextCursor: input.page.nextCursor,
  };
}
