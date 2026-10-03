// @vitest-environment node

import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeJob: vi.fn(),
  persistResearchResultInTransaction: vi.fn(),
  persistWebsiteAuditResultInTransaction: vi.fn(),
  persistQualificationResultInTransaction: vi.fn(),
  persistContactEnrichmentResultInTransaction: vi.fn(),
  persistDiscoveryPageInTransaction: vi.fn(),
  advancePipelineAfterResult: vi.fn(),
  prepareValidatedMessage: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("./job-manager", async (importOriginal) => ({
  ...await importOriginal<typeof import("./job-manager")>(),
  completeJob: mocks.completeJob,
}));
vi.mock("./research-manager", () => ({
  persistResearchResultInTransaction: mocks.persistResearchResultInTransaction,
}));
vi.mock("./qualification-manager", () => ({
  persistWebsiteAuditResultInTransaction: mocks.persistWebsiteAuditResultInTransaction,
  persistQualificationResultInTransaction: mocks.persistQualificationResultInTransaction,
}));
vi.mock("./contact-manager", () => ({
  persistContactEnrichmentResultInTransaction:
    mocks.persistContactEnrichmentResultInTransaction,
}));
vi.mock("./discovery-manager", () => ({
  persistDiscoveryPageInTransaction: mocks.persistDiscoveryPageInTransaction,
}));
vi.mock("./pipeline-manager", () => ({
  advancePipelineAfterResult: mocks.advancePipelineAfterResult,
}));
vi.mock("./message-manager", () => ({
  prepareValidatedMessage: mocks.prepareValidatedMessage,
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
    expect(rendered.sql).not.toContain("for update");
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

function specializedDatabase(kind: "audit_website" | "qualify" | "enrich_contact") {
  const execute = vi.fn(async (query: unknown) => {
    const rendered = dialect.sqlToQuery(query as Parameters<PgDialect["sqlToQuery"]>[0]);
    expect(rendered.sql).not.toContain("for update");
    return [{
      ownerId,
      kind,
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

  it("persists worker discovery candidates before completing the job", async () => {
    const work = {
      kind: "source_query" as const,
      id: "query:1",
      source: "web_search" as const,
      country: "AR",
      region: null,
      industry: "comercio",
      query: "comercios Argentina",
      cursor: { state: "initial" as const },
      geographyEvidence: null,
    };
    const candidate = {
      sourceType: "web_search" as const,
      sourceIdentity: "https://example.com/",
      sourceUrl: "https://example.com/",
      observedUrl: "https://example.com/",
      canonicalUrl: "https://example.com/",
      observedName: "Example",
      observedLocation: null,
      providerRank: 1,
      metadata: {},
    };
    const execute = vi.fn(async () => [{
      ownerId,
      runId: "00000000-0000-4000-8000-000000000003",
      kind: "discover",
      state: "leased",
      leaseOwner: "worker-api",
      leaseTokenDigest: digestLeaseToken(leaseToken),
      leaseExpiresAt: "2026-09-30T12:05:00.000Z",
      payload: work,
    }]);
    const database = { execute } as unknown as LeadHunterJobDatabase;
    mocks.persistDiscoveryPageInTransaction.mockResolvedValue({
      storedCandidates: 1,
      scheduledIdentityJobs: 1,
      nextCursor: { state: "exhausted" },
    });
    mocks.completeJob.mockResolvedValue({ status: "succeeded" });

    await completeClaimedJob(database, {
      id: jobId,
      leaseToken,
      completion: { result: {
        kind: "discover",
        output: {
          candidateCount: 1,
          candidates: [candidate],
          nextCursor: { state: "exhausted" },
        },
      } },
      now,
      maxAttempts: 3,
    });

    expect(mocks.persistDiscoveryPageInTransaction).toHaveBeenCalledWith(database, {
      ownerId,
      runId: "00000000-0000-4000-8000-000000000003",
      work,
      page: { candidates: [candidate], nextCursor: { state: "exhausted" } },
    });
    expect(mocks.completeJob).toHaveBeenCalledWith(database, expect.objectContaining({
      completion: { result: {
        kind: "discover",
        output: { candidateCount: 1, nextCursor: { state: "exhausted" } },
      } },
    }));
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

  it.each([
    ["audit_website" as const, "persistWebsiteAuditResultInTransaction" as const, { observations: [] }],
    ["qualify" as const, "persistQualificationResultInTransaction" as const, {}],
    ["enrich_contact" as const, "persistContactEnrichmentResultInTransaction" as const, { observations: [] }],
  ])("routes %s output through its evidence manager", async (kind, manager, output) => {
    const { database } = specializedDatabase(kind);
    mocks[manager].mockResolvedValue({ status: "processed" });

    await completeClaimedJob(database, {
      id: jobId,
      leaseToken,
      completion: { result: output },
      now,
      maxAttempts: 3,
    });

    expect(mocks[manager]).toHaveBeenCalledWith(database, {
      ownerId,
      jobId,
      leaseToken,
      now,
      output,
    });
    expect(mocks.completeJob).not.toHaveBeenCalled();
  });

  it.each(["audit_website", "qualify", "enrich_contact"] as const)(
    "preserves generic worker failures for %s",
    async (kind) => {
      const { database } = specializedDatabase(kind);
      mocks.completeJob.mockResolvedValue({ status: "failed" });
      const input = {
        id: jobId,
        leaseToken,
        completion: { error: "worker failed" },
        now,
        maxAttempts: 3,
      };

      await completeClaimedJob(database, input);

      expect(mocks.completeJob).toHaveBeenCalledWith(database, input);
      expect(mocks.persistWebsiteAuditResultInTransaction).not.toHaveBeenCalled();
      expect(mocks.persistQualificationResultInTransaction).not.toHaveBeenCalled();
      expect(mocks.persistContactEnrichmentResultInTransaction).not.toHaveBeenCalled();
    },
  );

  it.each(["audit_website", "qualify", "enrich_contact"] as const)(
    "rejects a wrong %s lease before specialized dispatch",
    async (kind) => {
      const execute = vi.fn(async () => [{
        ownerId,
        kind,
        state: "leased",
        leaseOwner: "worker-api",
        leaseTokenDigest: digestLeaseToken("different-token"),
        leaseExpiresAt: "2026-09-30T12:05:00.000Z",
      }]);
      const database = { execute } as unknown as LeadHunterJobDatabase;

      await expect(completeClaimedJob(database, {
        id: jobId,
        leaseToken,
        completion: { result: {} },
        now,
        maxAttempts: 3,
      })).rejects.toBeInstanceOf(JobCompletionRejectedError);

      expect(mocks.persistWebsiteAuditResultInTransaction).not.toHaveBeenCalled();
      expect(mocks.persistQualificationResultInTransaction).not.toHaveBeenCalled();
      expect(mocks.persistContactEnrichmentResultInTransaction).not.toHaveBeenCalled();
      expect(mocks.completeJob).not.toHaveBeenCalled();
    },
  );

  it("queues message preparation after contact enrichment without calling the model in the completion transaction", async () => {
    const enrollmentId = "00000000-0000-4000-8000-000000000004";
    const leadId = "00000000-0000-4000-8000-000000000005";
    const runId = "00000000-0000-4000-8000-000000000003";
    const execute = vi.fn(async () => [{
      ownerId,
      runId,
      enrollmentId,
      leadId,
      kind: "enrich_contact",
      state: "leased",
      leaseOwner: "worker-api",
      leaseTokenDigest: digestLeaseToken(leaseToken),
      leaseExpiresAt: "2026-09-30T12:05:00.000Z",
    }]);
    const database = { execute } as unknown as LeadHunterJobDatabase;
    mocks.persistContactEnrichmentResultInTransaction.mockResolvedValue({
      status: "processed",
      outcome: "selected",
      contactIds: ["00000000-0000-4000-8000-000000000006"],
      primaryContactId: "00000000-0000-4000-8000-000000000006",
      outboundBlocked: false,
    });

    await completeClaimedJob(database, {
      id: jobId,
      leaseToken,
      completion: { result: { observations: [] } },
      now,
      maxAttempts: 3,
    });

    expect(mocks.advancePipelineAfterResult).toHaveBeenCalledWith(database, {
      ownerId,
      runId,
      enrollmentId,
      leadId,
      kind: "enrich_contact",
    }, expect.objectContaining({ outcome: "selected", outboundBlocked: false }));
    expect(mocks.prepareValidatedMessage).not.toHaveBeenCalled();
  });
});
