// @vitest-environment node

import { createHash, randomUUID } from "node:crypto";

import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { PgDialect } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  claimNextJob,
  completeJob,
  JobCompletionRejectedError,
  JobCompletionValidationError,
  type LeadHunterJobDatabase,
} from "./job-manager";
import * as databaseSchema from "@/db/schema";
import { leadHunterJobs } from "@/db/schema";

const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const now = new Date("2026-09-30T12:00:00.000Z");
const leaseExpiresAt = new Date("2026-09-30T12:05:00.000Z");
const dialect = new PgDialect();

function queryText(query: unknown) {
  return dialect.sqlToQuery(query as Parameters<PgDialect["sqlToQuery"]>[0]);
}

describe("claimNextJob query contract", () => {
  it("atomically claims queued work with SKIP LOCKED and stores only a token digest", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const database = {
      execute: vi.fn(async (query: unknown) => {
        const rendered = queryText(query);
        statements.push(rendered);

        if (rendered.sql.includes("for update skip locked")) {
          return [{
            id: jobId,
            runId,
            kind: "discover",
            leaseExpiresAt: leaseExpiresAt.toISOString(),
            payload: { query: "distribuidores" },
          }];
        }
        return [];
      }),
    } as unknown as LeadHunterJobDatabase;

    const claimed = await claimNextJob(database, {
      now,
      leaseDurationMs: 5 * 60_000,
      maxAttempts: 3,
    });

    expect(claimed).toEqual({
      id: jobId,
      kind: "discover",
      leaseToken: expect.any(String),
      leaseExpiresAt,
      payload: { query: "distribuidores" },
    });
    expect(Object.keys(claimed ?? {}).sort()).toEqual([
      "id",
      "kind",
      "leaseExpiresAt",
      "leaseToken",
      "payload",
    ]);
    const claim = statements.find(({ sql }) => sql.includes("for update skip locked"));
    expect(claim?.sql).toContain("for update skip locked");
    expect(claim?.sql).toContain("\"state\" = 'queued'");
    expect(claim?.sql).toContain("state = 'leased'");
    expect(claim?.sql).toContain("attempt_count = job.attempt_count + 1");
    expect(claim?.sql).toContain("lease_token_digest");
    expect(claim?.params).not.toContain(claimed?.leaseToken);
    expect(claim?.params).toContain(
      createHash("sha256").update(claimed!.leaseToken).digest("hex"),
    );
  });

  it("requeues expired leases below the retry limit and terminally fails exhausted jobs", async () => {
    const statements: string[] = [];
    const database = {
      execute: vi.fn(async (query: unknown) => {
        statements.push(queryText(query).sql);
        return [];
      }),
    } as unknown as LeadHunterJobDatabase;

    await expect(claimNextJob(database, {
      now,
      leaseDurationMs: 60_000,
      maxAttempts: 3,
    })).resolves.toBeNull();

    expect(statements[0]).toContain(
      "when \"lh_jobs\".\"attempt_count\" >= $",
    );
    expect(statements[0]).toMatch(
      /then 'failed'::lh_job_state\s+else 'queued'::lh_job_state\s+end/,
    );
    expect(statements[0]).toContain("\"lease_expires_at\" <= $");
    expect(statements[0]).toContain("last_error = 'Lease expired'");
  });

  it("settles a run when lease expiry terminally fails its last job", async () => {
    const statements: string[] = [];
    const database = {
      execute: vi.fn(async (query: unknown) => {
        const rendered = queryText(query).sql;
        statements.push(rendered);
        if (rendered.includes("last_error = 'Lease expired'")) {
          return [{ runId, state: "failed" }];
        }
        return [];
      }),
    } as unknown as LeadHunterJobDatabase;

    await claimNextJob(database, {
      now,
      leaseDurationMs: 60_000,
      maxAttempts: 3,
    });

    expect(statements).toEqual(expect.arrayContaining([
      expect.stringMatching(/update "lh_runs" as run[\s\S]+summary\.active_count = 0/),
    ]));
  });
});

describe("completeJob", () => {
  it.each([
    ["discover", { candidateCount: 1 }],
    ["resolve_identity", {
      leadId: "11111111-1111-4111-8111-111111111111",
      confidence: 0.9,
    }],
    ["research", { evidenceIds: [] }],
    ["audit_website", {
      auditId: "22222222-2222-4222-8222-222222222222",
    }],
    ["qualify", { qualified: true, score: 75 }],
    ["enrich_contact", {
      contactIds: ["33333333-3333-4333-8333-333333333333"],
    }],
    ["prepare_message", {
      messageVersionId: "44444444-4444-4444-8444-444444444444",
    }],
    ["validate_message", { valid: true, issues: [] }],
  ] as const)("accepts the declared %s result contract", async (kind, output) => {
    const leaseToken = "current-lease-token";
    let statementCount = 0;
    const execute = vi.fn(async () => {
      statementCount += 1;
      if (statementCount === 1) {
        return [{
          id: jobId,
          runId,
          kind,
          state: "leased",
          result: null,
          attemptCount: 1,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
          leaseTokenDigest: createHash("sha256").update(leaseToken).digest("hex"),
        }];
      }
      return [];
    });
    const result = { kind, output };

    await expect(completeJob(
      { execute } as unknown as LeadHunterJobDatabase,
      {
        id: jobId,
        leaseToken,
        completion: { result },
        now,
        maxAttempts: 3,
      },
    )).resolves.toEqual({ status: "succeeded", result });
  });

  it.each([
    "discover",
    "resolve_identity",
    "research",
    "audit_website",
    "qualify",
    "enrich_contact",
    "prepare_message",
    "validate_message",
  ] as const)("rejects an output that does not match the %s contract", async (kind) => {
    const leaseToken = "current-lease-token";
    const execute = vi.fn(async () => [{
      id: jobId,
      runId,
      kind,
      state: "leased",
      result: null,
      attemptCount: 1,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      leaseTokenDigest: createHash("sha256").update(leaseToken).digest("hex"),
    }]);

    await expect(completeJob(
      { execute } as unknown as LeadHunterJobDatabase,
      {
        id: jobId,
        leaseToken,
        completion: { result: { kind, output: { unrelated: true } } },
        now,
        maxAttempts: 3,
      },
    )).rejects.toBeInstanceOf(JobCompletionValidationError);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("persists the explicit discovery cursor for the next planned run", async () => {
    const leaseToken = "current-lease-token";
    const statements: string[] = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query).sql;
      statements.push(rendered);
      if (rendered.includes("for update")) {
        return [{
          id: jobId,
          runId,
          kind: "discover",
          state: "leased",
          result: null,
          payload: {
            kind: "source_query",
            source: "web_search",
            country: "AR",
            region: null,
            industry: null,
            query: "distribuidores",
          },
          attemptCount: 1,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
          leaseTokenDigest: createHash("sha256").update(leaseToken).digest("hex"),
        }];
      }
      return [];
    });

    await completeJob(
      { execute } as unknown as LeadHunterJobDatabase,
      {
        id: jobId,
        leaseToken,
        completion: {
          result: {
            kind: "discover",
            output: {
              candidateCount: 1,
              nextCursor: { state: "next", value: "page:2" },
            },
          },
        },
        now,
        maxAttempts: 3,
      },
    );

    expect(statements).toEqual(expect.arrayContaining([
      expect.stringMatching(
        /update "lh_runs"[\s\S]+jsonb_set[\s\S]+previousCursors/,
      ),
    ]));
  });

  it("returns the stored result for an exact duplicate successful completion", async () => {
    const leaseToken = "a-previously-issued-lease-token";
    const storedResult = {
      kind: "discover",
      output: { candidateCount: 3 },
    };
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      if (rendered.sql.includes("for update")) {
        return [{
          id: jobId,
          runId,
          kind: "discover",
          state: "succeeded",
          result: storedResult,
          attemptCount: 1,
          leaseExpiresAt: null,
          leaseTokenDigest: createHash("sha256").update(leaseToken).digest("hex"),
        }];
      }
      throw new Error("duplicate completion must not transition the job");
    });

    await expect(completeJob(
      { execute } as unknown as LeadHunterJobDatabase,
      {
        id: jobId,
        leaseToken,
        completion: { result: storedResult },
        now,
        maxAttempts: 3,
      },
    )).resolves.toEqual({ status: "succeeded", result: storedResult });
    expect(execute).toHaveBeenCalledOnce();
  });

  it("validates the successful result against the claimed job kind", async () => {
    const leaseToken = "current-lease-token";
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      if (rendered.sql.includes("for update")) {
        return [{
          id: jobId,
          runId,
          kind: "discover",
          state: "leased",
          result: null,
          attemptCount: 1,
          leaseExpiresAt: leaseExpiresAt.toISOString(),
          leaseTokenDigest: createHash("sha256").update(leaseToken).digest("hex"),
        }];
      }
      return [];
    });

    await expect(completeJob(
      { execute } as unknown as LeadHunterJobDatabase,
      {
        id: jobId,
        leaseToken,
        completion: {
          result: { kind: "research", output: { evidenceIds: [] } },
        },
        now,
        maxAttempts: 3,
      },
    )).rejects.toBeInstanceOf(JobCompletionValidationError);
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each([
    {
      name: "near-match lease token",
      suppliedToken: "current-lease-tokenx",
      expiresAt: leaseExpiresAt.toISOString(),
    },
    {
      name: "expired lease",
      suppliedToken: "current-lease-token",
      expiresAt: now.toISOString(),
    },
  ])("rejects a $name without transitioning the job", async ({
    suppliedToken,
    expiresAt,
  }) => {
    const leaseToken = "current-lease-token";
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      if (rendered.sql.includes("for update")) {
        return [{
          id: jobId,
          runId,
          kind: "discover",
          state: "leased",
          result: null,
          attemptCount: 1,
          leaseExpiresAt: expiresAt,
          leaseTokenDigest: createHash("sha256").update(leaseToken).digest("hex"),
        }];
      }
      throw new Error("rejected completion must not transition the job");
    });

    await expect(completeJob(
      { execute } as unknown as LeadHunterJobDatabase,
      {
        id: jobId,
        leaseToken: suppliedToken,
        completion: {
          result: { kind: "discover", output: { candidateCount: 1 } },
        },
        now,
        maxAttempts: 3,
      },
    )).rejects.toBeInstanceOf(JobCompletionRejectedError);
    expect(execute).toHaveBeenCalledOnce();
  });
});

function explicitNonProductionDatabaseUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) return undefined;

  try {
    const url = new URL(value);
    const databaseName = url.pathname.slice(1).toLowerCase();
    if (!["postgres:", "postgresql:"].includes(url.protocol)) return undefined;
    return databaseName.includes("test") ? value : undefined;
  } catch {
    return undefined;
  }
}

const describeDatabase = explicitNonProductionDatabaseUrl()
  ? describe
  : describe.skip;
const testDatabaseUrl = explicitNonProductionDatabaseUrl();
const databaseClient = testDatabaseUrl
  ? postgres(testDatabaseUrl, { prepare: false, max: 4 })
  : undefined;
const database = databaseClient
  ? drizzle({ client: databaseClient, schema: databaseSchema })
  : undefined;

interface JobFixture {
  campaignId: string;
  jobIds: string[];
  ownerId: string;
  runId: string;
}

async function seedJobFixture(jobCount: number): Promise<JobFixture> {
  const ownerId = randomUUID();
  const campaignId = randomUUID();
  const runId = randomUUID();
  const scheduledFor = new Date("2026-09-30T12:00:00.000Z");

  await database!.execute(
    drizzleSql`insert into auth.users (id) values (${ownerId})`,
  );
  await database!.execute(drizzleSql`
    insert into public.lh_campaigns (
      id, owner_id, name, objective, service_focus, status,
      countries, sources, positive_criteria, negative_criteria,
      schedule, sequence_steps, daily_lead_limit, daily_email_limit,
      config_version, next_search_at
    ) values (
      ${campaignId}, ${ownerId}, 'Runtime integration', 'Exercise durable jobs',
      'automation', 'active',
      ${JSON.stringify(["AR"])}::jsonb,
      ${JSON.stringify(["web_search"])}::jsonb,
      '[]'::jsonb, '[]'::jsonb,
      ${JSON.stringify({
        searchDays: ["monday"],
        searchTime: "09:00",
        sendDays: ["tuesday"],
        sendStart: "10:00",
        sendEnd: "16:00",
        timezone: "America/Argentina/Buenos_Aires",
      })}::jsonb,
      ${JSON.stringify([{
        delayDays: 0,
        subjectInstruction: "Introduce",
        bodyInstruction: "Ask",
      }])}::jsonb,
      10, 10, 1, ${scheduledFor}
    )
  `);
  await database!.execute(drizzleSql`
    insert into public.lh_campaign_versions (
      owner_id, campaign_id, version, snapshot
    ) values (${ownerId}, ${campaignId}, 1, '{}'::jsonb)
  `);
  await database!.execute(drizzleSql`
    insert into public.lh_runs (
      id, owner_id, campaign_id, campaign_version, scheduled_for, plan
    ) values (
      ${runId}, ${ownerId}, ${campaignId}, 1, ${scheduledFor}, '{}'::jsonb
    )
  `);

  const jobIds = Array.from({ length: jobCount }, () => randomUUID());
  await database!.insert(leadHunterJobs).values(jobIds.map((id, index) => ({
    id,
    ownerId,
    runId,
    kind: "discover" as const,
    payload: { index },
    idempotencyKey: `${runId}:discover:${index}`,
  })));

  return { campaignId, jobIds, ownerId, runId };
}

async function cleanupJobFixture(fixture: JobFixture) {
  await database!.execute(
    drizzleSql`delete from public.lh_campaigns where id = ${fixture.campaignId}`,
  );
  await database!.execute(
    drizzleSql`delete from auth.users where id = ${fixture.ownerId}`,
  );
}

afterAll(async () => {
  await databaseClient?.end();
});

describeDatabase("LeadHunter job manager database integration", () => {
  it("lets concurrent workers claim different rows without blocking", async () => {
    const fixture = await seedJobFixture(2);

    try {
      const [first, second] = await Promise.all([
        database!.transaction((transaction) => claimNextJob(transaction, {
          now,
          leaseDurationMs: 60_000,
          maxAttempts: 3,
        })),
        database!.transaction((transaction) => claimNextJob(transaction, {
          now,
          leaseDurationMs: 60_000,
          maxAttempts: 3,
        })),
      ]);

      expect(first).not.toBeNull();
      expect(second).not.toBeNull();
      expect(new Set([first?.id, second?.id])).toEqual(new Set(fixture.jobIds));
    } finally {
      await cleanupJobFixture(fixture);
    }
  }, 30_000);

  it("reclaims an expired lease once and terminally fails it at the limit", async () => {
    const fixture = await seedJobFixture(1);

    try {
      const first = await database!.transaction((transaction) =>
        claimNextJob(transaction, {
          now,
          leaseDurationMs: 1_000,
          maxAttempts: 2,
        }));
      const secondNow = new Date(now.getTime() + 2_000);
      const second = await database!.transaction((transaction) =>
        claimNextJob(transaction, {
          now: secondNow,
          leaseDurationMs: 1_000,
          maxAttempts: 2,
        }));
      const exhausted = await database!.transaction((transaction) =>
        claimNextJob(transaction, {
          now: new Date(secondNow.getTime() + 2_000),
          leaseDurationMs: 1_000,
          maxAttempts: 2,
        }));

      expect(first?.id).toBe(fixture.jobIds[0]);
      expect(second?.id).toBe(fixture.jobIds[0]);
      expect(exhausted).toBeNull();
      const [stored] = await database!
        .select({
          state: leadHunterJobs.state,
          attemptCount: leadHunterJobs.attemptCount,
          lastError: leadHunterJobs.lastError,
        })
        .from(leadHunterJobs)
        .where(drizzleSql`${leadHunterJobs.id} = ${fixture.jobIds[0]}`);
      expect(stored).toEqual({
        state: "failed",
        attemptCount: 2,
        lastError: "Lease expired",
      });
    } finally {
      await cleanupJobFixture(fixture);
    }
  }, 30_000);

  it("returns the stored result when successful completion is retried", async () => {
    const fixture = await seedJobFixture(1);

    try {
      const claimed = await database!.transaction((transaction) =>
        claimNextJob(transaction, {
          now,
          leaseDurationMs: 60_000,
          maxAttempts: 3,
        }));
      expect(claimed).not.toBeNull();
      const result = {
        kind: "discover" as const,
        output: { candidateCount: 2 },
      };
      const input = {
        id: claimed!.id,
        leaseToken: claimed!.leaseToken,
        completion: { result },
        now,
        maxAttempts: 3,
      };

      await expect(database!.transaction((transaction) =>
        completeJob(transaction, input))).resolves.toEqual({
        status: "succeeded",
        result,
      });
      await expect(database!.transaction((transaction) =>
        completeJob(transaction, {
          ...input,
          completion: {
            result: { kind: "discover", output: { candidateCount: 999 } },
          },
        }))).resolves.toEqual({ status: "succeeded", result });
    } finally {
      await cleanupJobFixture(fixture);
    }
  }, 30_000);
});
