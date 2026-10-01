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
  type ClaimedJob,
  type LeadHunterJobDatabase,
} from "./job-manager";
import * as databaseSchema from "@/db/schema";
import { leadHunterJobs, leadHunterRuns } from "@/db/schema";

const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const claimedOwnerId = "99999999-9999-4999-8999-999999999999";
const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const now = new Date("2026-09-30T12:00:00.000Z");
const leaseExpiresAt = new Date("2026-09-30T12:05:00.000Z");
const dialect = new PgDialect();
const candidateId = "11111111-1111-4111-8111-111111111111";
const leadId = "22222222-2222-4222-8222-222222222222";
const enrollmentId = "33333333-3333-4333-8333-333333333333";
const messageVersionId = "44444444-4444-4444-8444-444444444444";

const validJobContracts = [
  {
    kind: "discover",
    payload: {
      kind: "seed_url",
      id: "seed:one",
      url: "https://example.com",
    },
    output: { candidateCount: 1 },
  },
  {
    kind: "resolve_identity",
    payload: { candidateId },
    output: { leadId, confidence: 0.9 },
  },
  {
    kind: "research",
    payload: { leadId },
    output: { evidenceIds: [] },
  },
  {
    kind: "audit_website",
    payload: { leadId, website: "https://example.com" },
    output: {
      auditId: "55555555-5555-4555-8555-555555555555",
      gateResult: "BAD_WEBSITE",
    },
  },
  {
    kind: "qualify",
    payload: { leadId },
    output: { decision: "eligible", score: 75 },
  },
  {
    kind: "enrich_contact",
    payload: {
      leadId,
      sources: [{
        ref: "official-contact",
        sourceUrl: "https://example.com/contact",
        sourceType: "official_site",
        contentSha256: "a".repeat(64),
        suppliedAt: "2026-09-30T12:00:00.000Z",
      }],
    },
    output: {
      outcome: "selected",
      contactIds: ["66666666-6666-4666-8666-666666666666"],
      primaryContactId: "66666666-6666-4666-8666-666666666666",
      outboundBlocked: false,
    },
  },
  {
    kind: "prepare_message",
    payload: { enrollmentId },
    output: { messageVersionId },
  },
  {
    kind: "validate_message",
    payload: { messageVersionId },
    output: { valid: true, issues: [] },
  },
] as const;

type ClaimedPayloadIsUnknown = unknown extends ClaimedJob["payload"]
  ? true
  : false;
type ClaimedExpiryIsExactlyString = ClaimedJob["leaseExpiresAt"] extends string
  ? string extends ClaimedJob["leaseExpiresAt"]
    ? true
    : false
  : false;

const claimedPayloadIsUnknown: ClaimedPayloadIsUnknown = true;
const claimedExpiryIsExactlyString: ClaimedExpiryIsExactlyString = true;

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
            ownerId: claimedOwnerId,
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
      ownerId: claimedOwnerId,
      runId,
      kind: "discover",
      leaseToken: expect.any(String),
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      payload: { query: "distribuidores" },
    });
    expect(claimedPayloadIsUnknown).toBe(true);
    expect(claimedExpiryIsExactlyString).toBe(true);
    expect(Object.keys(claimed ?? {}).sort()).toEqual([
      "id",
      "kind",
      "leaseExpiresAt",
      "leaseToken",
      "ownerId",
      "payload",
      "runId",
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
    const lockIndex = statements.findIndex((statement) =>
      /select[\s\S]+from "lh_runs"[\s\S]+for update/.test(statement));
    const settlementIndex = statements.findIndex((statement) =>
      statement.includes("update \"lh_runs\" as run"));
    expect(lockIndex).toBeGreaterThan(0);
    expect(settlementIndex).toBeGreaterThan(lockIndex);
  });
});

describe("completeJob", () => {
  it.each(validJobContracts.filter(({ kind }) => (
    !["research", "audit_website", "qualify", "enrich_contact"].includes(kind)
  )))(
    "accepts the declared $kind payload and result contract",
    async ({
      kind,
      output,
      payload,
    }) => {
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
            payload,
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
    },
  );

  it.each(validJobContracts)("rejects an output that does not match the $kind contract", async ({
    kind,
    payload,
  }) => {
    const leaseToken = "current-lease-token";
    const execute = vi.fn(async () => [{
      id: jobId,
      runId,
      kind,
      state: "leased",
      result: null,
      payload,
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

  it.each(validJobContracts)("rejects a malformed $kind payload before transitioning", async ({
    kind,
    output,
  }) => {
    const leaseToken = "current-lease-token";
    const execute = vi.fn(async () => [{
      id: jobId,
      runId,
      kind,
      state: "leased",
      result: null,
      payload: { unrelated: true },
      attemptCount: 1,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      leaseTokenDigest: createHash("sha256").update(leaseToken).digest("hex"),
    }]);

    await expect(completeJob(
      { execute } as unknown as LeadHunterJobDatabase,
      {
        id: jobId,
        leaseToken,
        completion: { result: { kind, output } },
        now,
        maxAttempts: 3,
      },
    )).rejects.toBeInstanceOf(JobCompletionValidationError);
    expect(execute).toHaveBeenCalledOnce();
  });

  it.each([
    { candidateCount: 1 },
    { candidateCount: 1, nextCursor: { state: "initial" } },
  ])("requires a next or exhausted cursor for source-query discovery %#", async (output) => {
    const leaseToken = "current-lease-token";
    const execute = vi.fn(async () => [{
      id: jobId,
      runId,
      kind: "discover",
      state: "leased",
      result: null,
      payload: {
        kind: "source_query",
        id: "query:one",
        source: "web_search",
        country: "AR",
        region: null,
        industry: null,
        query: "distribuidores",
        cursor: { state: "initial" },
        geographyEvidence: null,
      },
      attemptCount: 1,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
      leaseTokenDigest: createHash("sha256").update(leaseToken).digest("hex"),
    }]);

    await expect(completeJob(
      { execute } as unknown as LeadHunterJobDatabase,
      {
        id: jobId,
        leaseToken,
        completion: { result: { kind: "discover", output } },
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
            id: "query:one",
            source: "web_search",
            country: "AR",
            region: null,
            industry: null,
            query: "distribuidores",
            cursor: { state: "initial" },
            geographyEvidence: null,
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
          payload: validJobContracts[0].payload,
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

describe("database integration guard", () => {
  it.each([
    { testUrl: undefined },
    { testUrl: "not-a-url" },
    { testUrl: "mysql://user:password@localhost/kazeos_test" },
    { testUrl: "postgresql://user:password@localhost/kazeos_production" },
    { testUrl: "postgresql://user:password@localhost/kazeos_prod" },
    { testUrl: "postgresql://user:password@localhost/kazeos_test_prod" },
    { testUrl: "postgresql://user:password@localhost/postgres" },
    { testUrl: "postgresql://user:password@localhost/contest" },
    { testUrl: "postgresql://user:password@localhost/latest" },
    { testUrl: "postgresql://user:password@localhost/testimonials" },
    {
      testUrl: "postgresql://user:password@localhost/kazeos_test",
      databaseUrl: "postgresql://user:password@localhost/kazeos_test",
      confirmation: "leadhunter-test-only",
    },
    {
      testUrl:
        "postgresql://test_role:test_password@LOCALHOST/kazeos_test?sslmode=require#worker",
      databaseUrl:
        "postgres://app_role:app_password@localhost:5432/kazeos_test?application_name=kazeos",
      confirmation: "leadhunter-test-only",
    },
    {
      testUrl: "postgresql://user:password@localhost/kazeos_test",
      databaseUrl: "postgresql://user:password@localhost/kazeos_prod",
      confirmation: "wrong-confirmation",
    },
  ])("reports a safe explicit reason when TEST_DATABASE_URL is not isolated %#", ({
    testUrl,
    databaseUrl = "postgresql://user:password@localhost/kazeos_prod",
    confirmation,
  }) => {
    const configuration = databaseTestConfiguration(
      testUrl,
      databaseUrl,
      confirmation,
    );

    expect(configuration).toEqual({
      databaseUrl: undefined,
      skipReason:
        "LeadHunter PostgreSQL integration skipped: an explicit isolated TEST_DATABASE_URL is required.",
    });
    expect(JSON.stringify(configuration)).not.toContain("password");
  });

  it("accepts only an explicit PostgreSQL test database URL", () => {
    const value = "postgresql://localhost/kazeos_test";

    expect(databaseTestConfiguration(
      value,
      "postgresql://localhost/kazeos_prod",
      "leadhunter-test-only",
    )).toEqual({
      databaseUrl: value,
      skipReason: undefined,
    });
  });

  it("accepts a different canonical database target without overwriting DATABASE_URL", () => {
    const value = "postgresql://test_role@localhost:5433/kazeos_test?sslmode=require";

    expect(databaseTestConfiguration(
      value,
      "postgresql://app_role@localhost:5432/kazeos_test?sslmode=require",
      "leadhunter-test-only",
    )).toEqual({
      databaseUrl: value,
      skipReason: undefined,
    });
    expect(databaseTestConfiguration(
      value,
      undefined,
      "leadhunter-test-only",
    )).toEqual({
      databaseUrl: value,
      skipReason: undefined,
    });
  });
});

const integrationDatabaseSkipReason =
  "LeadHunter PostgreSQL integration skipped: an explicit isolated TEST_DATABASE_URL is required.";

function canonicalPostgresTarget(url: URL): string | undefined {
  if (!["postgres:", "postgresql:"].includes(url.protocol)) return undefined;
  if (!url.hostname || url.pathname.length <= 1) return undefined;

  const hostname = url.hostname.toLowerCase();
  const port = url.port || "5432";
  const databasePath = decodeURIComponent(url.pathname);
  return `postgresql://${hostname}:${port}${databasePath}`;
}

function databaseTestConfiguration(
  value: string | undefined,
  applicationDatabaseUrl: string | undefined,
  mutationConfirmation: string | undefined,
): {
  databaseUrl: string | undefined;
  skipReason: string | undefined;
} {
  if (!value) {
    return {
      databaseUrl: undefined,
      skipReason: integrationDatabaseSkipReason,
    };
  }

  try {
    const url = new URL(value);
    const testTarget = canonicalPostgresTarget(url);
    const databaseName = decodeURIComponent(url.pathname.slice(1)).toLowerCase();
    const hasTestToken = /(^|[_-])test($|[_-])/.test(databaseName);
    const hasProductionToken = /(^|[_-])(main|prod|production|live)($|[_-])/
      .test(databaseName);
    let matchesApplicationDatabase = false;
    if (applicationDatabaseUrl) {
      try {
        const applicationTarget = canonicalPostgresTarget(
          new URL(applicationDatabaseUrl),
        );
        matchesApplicationDatabase = !applicationTarget
          || applicationTarget === testTarget;
      } catch {
        matchesApplicationDatabase = true;
      }
    }
    const isolated = testTarget !== undefined
      && hasTestToken
      && !hasProductionToken
      && !matchesApplicationDatabase
      && mutationConfirmation === "leadhunter-test-only";
    return isolated
      ? { databaseUrl: value, skipReason: undefined }
      : {
          databaseUrl: undefined,
          skipReason: integrationDatabaseSkipReason,
        };
  } catch {
    return {
      databaseUrl: undefined,
      skipReason: integrationDatabaseSkipReason,
    };
  }
}

const databaseTestConfigurationResult = databaseTestConfiguration(
  process.env.TEST_DATABASE_URL,
  process.env.DATABASE_URL,
  process.env.LEADHUNTER_TEST_DATABASE_CONFIRM,
);
const testDatabaseUrl = databaseTestConfigurationResult.databaseUrl;
if (databaseTestConfigurationResult.skipReason) {
  process.stderr.write(`${databaseTestConfigurationResult.skipReason}\n`);
}
const describeDatabase = testDatabaseUrl
  ? describe
  : describe.skip;
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
    payload: {
      kind: "seed_url" as const,
      id: `seed:${index}`,
      url: `https://example.com/${index}`,
    },
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

  it("serializes concurrent terminal completions and closes the parent run", async () => {
    const fixture = await seedJobFixture(2);

    try {
      const claimed = await Promise.all([
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
      await Promise.all(claimed.map((job) => database!.transaction(
        (transaction) => completeJob(transaction, {
          id: job!.id,
          leaseToken: job!.leaseToken,
          completion: {
            result: { kind: "discover", output: { candidateCount: 1 } },
          },
          now,
          maxAttempts: 3,
        }),
      )));

      const [run] = await database!
        .select({ state: leadHunterRuns.state, counts: leadHunterRuns.counts })
        .from(leadHunterRuns)
        .where(drizzleSql`${leadHunterRuns.id} = ${fixture.runId}`);
      expect(run).toEqual({
        state: "completed",
        counts: { total: 2, succeeded: 2, failed: 0 },
      });
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
