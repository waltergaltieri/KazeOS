// @vitest-environment node

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  persistResearchResult,
  type LeadHunterResearchDatabase,
  type LeadHunterResearchTransaction,
} from "./research-manager";
import {
  digestLeaseToken,
  JobCompletionRejectedError,
} from "./job-manager";

const dialect = new PgDialect();
const ownerId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const enrollmentId = "00000000-0000-4000-8000-000000000004";
const leadId = "00000000-0000-4000-8000-000000000005";
const campaignId = "00000000-0000-4000-8000-000000000006";
const sourceUrl = "https://Example.com/about?b=2&a=1#team";
const suppliedAt = "2026-09-30T12:00:00.000Z";
const contentSha256 = "a".repeat(64);
const leaseToken = "task7-research-lease-token";
const now = new Date("2026-09-30T12:01:00.000Z");

function queryText(query: unknown) {
  return dialect.sqlToQuery(query as Parameters<PgDialect["sqlToQuery"]>[0]);
}

function transactionalDatabase(execute: (query: unknown) => Promise<unknown>) {
  const transaction = vi.fn(async (
    operation: (database: LeadHunterResearchTransaction) => Promise<unknown>,
  ) => operation({ execute } as unknown as LeadHunterResearchTransaction));
  return {
    database: { transaction } as unknown as LeadHunterResearchDatabase,
    transaction,
  };
}

function lockedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: jobId,
    runId,
    enrollmentId,
    leadId,
    campaignId,
    campaignVersion: 3,
    state: "leased",
    kind: "research",
    payload: {
      leadId,
      source: { sourceUrl, sourceType: "official_site", suppliedAt, contentSha256 },
      budget: {
        maxRuntimeMs: 2_000,
        maxModelCalls: 1,
        maxInputTokens: 2_000,
        maxOutputTokens: 1_000,
        maxCostUsd: 0.1,
      },
    },
    result: null,
    leaseTokenDigest: digestLeaseToken(leaseToken),
    leaseExpiresAt: "2026-09-30T12:05:00.000Z",
    leaseOwner: "worker-api",
    researchSummary: null,
    questions: [
      { key: "business_name", prompt: "Nombre", required: true },
      { key: "business_activity", prompt: "Actividad", required: true },
    ],
    ...overrides,
  };
}

function workerOutput(findings: unknown[]) {
  return {
    source_url: sourceUrl,
    source_type: "official_site",
    supplied_at: suppliedAt,
    content_sha256: contentSha256,
    findings,
    diagnostics: [],
    usage: {
      extractor: "offline-v1",
      elapsed_ms: 7,
      model_calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
    },
  };
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    field: "business_name",
    value: "Acme Distribuciones",
    status: "verified",
    confidence: 94,
    source_url: sourceUrl,
    extract: "Acme Distribuciones",
    ...overrides,
  };
}

function persistenceInput(output: unknown) {
  return { ownerId, jobId, leaseToken, now, output };
}

describe("LeadHunter research manager", () => {
  it("locks trusted state and stores evidence, dossier, activity and completion atomically", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      if (rendered.sql.includes('from "lh_jobs" as job')) return [lockedJob()];
      return [];
    });
    const { database, transaction } = transactionalDatabase(execute);

    const result = await persistResearchResult(
      database,
      persistenceInput(workerOutput([finding()])),
    );

    expect(result).toMatchObject({ status: "processed", evidenceIds: [expect.any(String)] });
    expect(transaction).toHaveBeenCalledOnce();
    const lock = statements.find(({ sql }) => sql.includes('from "lh_jobs" as job'));
    expect(lock?.sql).toContain("job.owner_id = $");
    expect(lock?.sql).toContain("for update of job, enrollment");
    expect(lock?.sql).toContain('version.owner_id = job.owner_id');
    expect(lock?.sql).toContain('version.campaign_id = enrollment.campaign_id');
    expect(lock?.sql).toContain('version.version = enrollment.campaign_version');
    expect(lock?.sql).toContain('job.lease_token_digest as "leaseTokenDigest"');
    expect(lock?.sql).toContain('job.lease_expires_at as "leaseExpiresAt"');
    expect(lock?.sql).toContain('job.lease_owner as "leaseOwner"');
    expect(JSON.stringify(statements)).not.toContain(leaseToken);

    const evidenceInsert = statements.find(({ sql }) => sql.includes('insert into "lh_evidence"'));
    expect(evidenceInsert?.sql).toContain("on conflict (id) do nothing");
    expect(evidenceInsert?.params).toEqual(expect.arrayContaining([
      ownerId,
      leadId,
      runId,
      campaignId,
      3,
      "business_name",
      "verified",
      sourceUrl,
      "Acme Distribuciones",
      suppliedAt,
    ]));
    const enrollmentUpdate = statements.find(({ sql }) => sql.includes('update "lh_enrollments"'));
    expect(enrollmentUpdate?.sql).toContain('where "lh_enrollments"."owner_id" =');
    expect(enrollmentUpdate?.params).toEqual(expect.arrayContaining([ownerId, enrollmentId]));
    const activityInsert = statements.find(({ sql }) => sql.includes('insert into "lh_activity"'));
    expect(activityInsert?.sql).toContain("on conflict (id) do nothing");
    const detail = JSON.parse(String(activityInsert?.params.at(-1)));
    expect(detail).toMatchObject({ jobId, acceptedCount: 1, rejected: [] });
    const jobUpdate = statements.find(({ sql }) => sql.includes('update "lh_jobs"'));
    expect(jobUpdate?.sql).toContain("state = 'succeeded'");
    expect(JSON.parse(String(jobUpdate?.params[0]))).toEqual({
      kind: "research",
      output: { evidenceIds: result.evidenceIds },
    });
  });

  it("persists bounded rejected diagnostics while retaining valid findings", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      if (rendered.sql.includes('from "lh_jobs" as job')) return [lockedJob()];
      return [];
    });
    const { database } = transactionalDatabase(execute);

    const result = await persistResearchResult(database, persistenceInput(
      workerOutput([
        finding(),
        finding({ field: "business_secret", value: "do not store", extract: "do not store" }),
      ]),
    ));

    expect(result).toMatchObject({ status: "processed", rejectedCount: 1 });
    expect(statements.filter(({ sql }) => sql.includes('insert into "lh_evidence"'))).toHaveLength(1);
    const activity = statements.find(({ sql }) => sql.includes('insert into "lh_activity"'));
    const detail = JSON.parse(String(activity?.params.at(-1)));
    expect(detail.rejected).toEqual([
      expect.objectContaining({ index: 1, code: "unsupported_question" }),
    ]);
    expect(JSON.stringify(detail)).not.toContain("do not store");
  });

  it("reduces the dossier from all persisted campaign-version evidence", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      if (rendered.sql.includes('from "lh_jobs" as job')) return [lockedJob()];
      if (
        rendered.sql.includes('from "lh_evidence"')
        && rendered.sql.includes('"questionKey"')
      ) {
        return [{
          id: "00000000-0000-5000-8000-000000000020",
          questionKey: "business_activity",
          field: "business_activity",
          value: "Distribución mayorista",
          status: "verified",
          confidence: 90,
          sourceUrl: "https://example.com/services",
          sourceType: "official_site",
          suppliedAt,
          extract: "Distribución mayorista",
          contentHash: "b".repeat(64),
        }];
      }
      return [];
    });
    const { database } = transactionalDatabase(execute);

    await persistResearchResult(database, persistenceInput(workerOutput([finding()])));

    const enrollmentUpdate = statements.find(({ sql }) => sql.includes('update "lh_enrollments"'));
    const dossier = JSON.parse(String(enrollmentUpdate?.params[0]));
    expect(dossier.answers.business_name.status).toBe("verified");
    expect(dossier.answers.business_activity).toMatchObject({
      status: "verified",
      values: ["Distribución mayorista"],
    });
    expect(dossier.requiredUnknowns).toEqual([]);
  });

  it("rejects a malformed worker envelope, records one audit event and stores no evidence", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      if (rendered.sql.includes('from "lh_jobs" as job')) return [lockedJob()];
      return [];
    });
    const { database } = transactionalDatabase(execute);

    const result = await persistResearchResult(
      database,
      persistenceInput({ ...workerOutput([finding()]), sendMail: true }),
    );

    expect(result).toMatchObject({ status: "rejected", evidenceIds: [] });
    expect(statements.some(({ sql }) => sql.includes('insert into "lh_evidence"'))).toBe(false);
    const jobUpdate = statements.find(({ sql }) => sql.includes('update "lh_jobs"'));
    expect(jobUpdate?.sql).toContain("state = 'failed'");
    expect(jobUpdate?.sql).toContain("last_error = 'research_output_rejected'");
  });

  it("returns a succeeded job without duplicating evidence or activity", async () => {
    const evidenceId = "00000000-0000-5000-8000-000000000010";
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      if (rendered.sql.includes('from "lh_jobs" as job')) {
        return [lockedJob({
          state: "succeeded",
          result: { kind: "research", output: { evidenceIds: [evidenceId] } },
          researchSummary: {
            answers: {}, requiredUnknowns: [], usableFactIds: [], conflicts: [],
          },
        })];
      }
      throw new Error("unexpected write");
    });
    const { database } = transactionalDatabase(execute);

    const result = await persistResearchResult(
      database,
      persistenceInput(workerOutput([finding()])),
    );

    expect(result).toMatchObject({ status: "already_processed", evidenceIds: [evidenceId] });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("cannot attach output through another owner or mismatched job kind", async () => {
    const missingExecute = vi.fn(async () => []);
    const { database: missingDatabase } = transactionalDatabase(missingExecute);
    await expect(persistResearchResult(missingDatabase, {
      ...persistenceInput(workerOutput([])),
      ownerId: "00000000-0000-4000-8000-000000000099",
    })).rejects.toBeInstanceOf(JobCompletionRejectedError);

    const wrongKindExecute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      if (rendered.sql.includes('from "lh_jobs" as job')) return [lockedJob({ kind: "qualify" })];
      return [];
    });
    const { database: wrongKindDatabase } = transactionalDatabase(wrongKindExecute);
    await expect(persistResearchResult(
      wrongKindDatabase,
      persistenceInput(workerOutput([])),
    )).rejects.toThrow("not a research job");
  });

  it.each([
    {
      name: "wrong token",
      input: { leaseToken: "superseded-research-lease-token", now },
      row: {},
    },
    {
      name: "expired lease",
      input: { leaseToken, now: new Date("2026-09-30T12:05:00.000Z") },
      row: {},
    },
    {
      name: "superseded digest",
      input: { leaseToken, now },
      row: { leaseTokenDigest: digestLeaseToken("newer-lease-token") },
    },
    {
      name: "invalid trusted clock",
      input: { leaseToken, now: new Date("invalid") },
      row: {},
    },
    {
      name: "invalid persisted expiry",
      input: { leaseToken, now },
      row: { leaseExpiresAt: "not-a-database-date" },
    },
    {
      name: "unexpected lease owner",
      input: { leaseToken, now },
      row: { leaseOwner: "another-worker-boundary" },
    },
  ])("rejects a $name without persisting anything", async ({ input: leaseInput, row }) => {
    const statements: string[] = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered.sql);
      if (rendered.sql.includes('from "lh_jobs" as job')) return [lockedJob(row)];
      throw new Error("unexpected write");
    });
    const { database } = transactionalDatabase(execute);

    await expect(persistResearchResult(database, {
      ownerId,
      jobId,
      output: { ...workerOutput([finding()]), sendMail: true },
      ...leaseInput,
    })).rejects.toBeInstanceOf(JobCompletionRejectedError);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('from "lh_jobs" as job');
  });
});
