// @vitest-environment node

import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeJob: vi.fn(),
  persistResearchResultInTransaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./job-manager", async (importOriginal) => ({
  ...await importOriginal<typeof import("./job-manager")>(),
  completeJob: mocks.completeJob,
}));
vi.mock("./research-manager", () => ({
  persistResearchResultInTransaction: mocks.persistResearchResultInTransaction,
}));

import { completeClaimedJob } from "./completion-manager";
import {
  digestLeaseToken,
  JobCompletionRejectedError,
  type LeadHunterJobDatabase,
} from "./job-manager";

const dialect = new PgDialect();
const ownerId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const leaseToken = "raw-research-lease-token";
const now = new Date("2026-09-30T12:00:00.000Z");

function researchDatabase() {
  const execute = vi.fn(async (query: unknown) => {
    const rendered = dialect.sqlToQuery(query as Parameters<PgDialect["sqlToQuery"]>[0]);
    expect(rendered.sql).toContain("for update");
    return [{
      ownerId,
      kind: "research",
      state: "leased",
      leaseOwner: "worker-api",
      leaseTokenDigest: digestLeaseToken(leaseToken),
      leaseExpiresAt: "2026-09-30T12:05:00.000Z",
    }];
  });
  return { database: { execute } as unknown as LeadHunterJobDatabase, execute };
}

describe("LeadHunter completion dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["valid", { source_url: "https://example.com", findings: [] }],
    ["malformed", { sendMail: true }],
  ])("routes %s research output through the evidence manager", async (_name, output) => {
    const { database } = researchDatabase();
    mocks.persistResearchResultInTransaction.mockResolvedValue({ status: "processed" });

    await completeClaimedJob(database, {
      id: jobId,
      leaseToken,
      completion: { result: output },
      now,
      maxAttempts: 3,
    });

    expect(mocks.persistResearchResultInTransaction).toHaveBeenCalledWith(database, {
      ownerId,
      jobId,
      leaseToken,
      now,
      output,
    });
    expect(mocks.completeJob).not.toHaveBeenCalled();
  });

  it("rejects a wrong lease before classifying a generic research result", async () => {
    const execute = vi.fn(async () => [{
      ownerId,
      kind: "research",
      state: "leased",
      leaseOwner: "worker-api",
      leaseTokenDigest: "0".repeat(64),
      leaseExpiresAt: "2026-09-30T12:05:00.000Z",
    }]);
    const database = { execute } as unknown as LeadHunterJobDatabase;

    await expect(completeClaimedJob(database, {
      id: jobId,
      leaseToken: "wrong-token",
      completion: { result: { evidenceIds: [] } },
      now,
      maxAttempts: 3,
    })).rejects.toBeInstanceOf(JobCompletionRejectedError);

    expect(execute).toHaveBeenCalledOnce();
    expect(mocks.persistResearchResultInTransaction).not.toHaveBeenCalled();
    expect(mocks.completeJob).not.toHaveBeenCalled();
  });

  it.each([
    { evidenceIds: [] },
    { kind: "research", output: { evidenceIds: [] } },
  ])("routes a generic research result shape through strict evidence audit: %#", async (output) => {
    const { database } = researchDatabase();
    mocks.persistResearchResultInTransaction.mockResolvedValue({
      status: "rejected",
      evidenceIds: [],
      rejectedCount: 1,
      dossier: null,
    });

    await expect(completeClaimedJob(database, {
      id: jobId,
      leaseToken,
      completion: { result: output },
      now,
      maxAttempts: 3,
    })).resolves.toMatchObject({ status: "rejected", evidenceIds: [] });

    expect(mocks.persistResearchResultInTransaction).toHaveBeenCalledWith(database, {
      ownerId,
      jobId,
      leaseToken,
      now,
      output,
    });
    expect(mocks.completeJob).not.toHaveBeenCalled();
  });

  it("propagates a wrong research lease without falling back to generic completion", async () => {
    const { database, execute } = researchDatabase();
    mocks.persistResearchResultInTransaction.mockRejectedValue(
      new JobCompletionRejectedError(),
    );

    await expect(completeClaimedJob(database, {
      id: jobId,
      leaseToken: "wrong-token",
      completion: { result: { findings: [] } },
      now,
      maxAttempts: 3,
    })).rejects.toBeInstanceOf(JobCompletionRejectedError);

    expect(execute).toHaveBeenCalledOnce();
    expect(mocks.completeJob).not.toHaveBeenCalled();
  });

  it("preserves generic completion for non-research jobs and research errors", async () => {
    const genericExecute = vi.fn(async () => [{ ownerId, kind: "discover" }]);
    const genericDatabase = { execute: genericExecute } as unknown as LeadHunterJobDatabase;
    mocks.completeJob.mockResolvedValue({ status: "succeeded" });
    const genericInput = {
      id: jobId,
      leaseToken,
      completion: { result: { kind: "discover", output: { candidateCount: 1 } } },
      now,
      maxAttempts: 3,
    };

    await completeClaimedJob(genericDatabase, genericInput);
    expect(mocks.completeJob).toHaveBeenCalledWith(genericDatabase, genericInput);

    const { database: research } = researchDatabase();
    const failureInput = {
      id: jobId,
      leaseToken,
      completion: { error: "provider failed" },
      now,
      maxAttempts: 3,
    };
    await completeClaimedJob(research, failureInput);
    expect(mocks.completeJob).toHaveBeenCalledWith(research, failureInput);
  });
});
