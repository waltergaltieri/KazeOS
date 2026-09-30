// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  completeJob,
  digestLeaseToken,
  JobCompletionValidationError,
  type LeadHunterJobDatabase,
} from "./job-manager";

const leaseToken = "bounded-research-result-token";

describe("LeadHunter research job result bounds", () => {
  it("rejects generic research completion even after evidence completion succeeded", async () => {
    const stored = { kind: "research", output: { evidenceIds: [] } };
    const execute = vi.fn(async () => [{
      id: "00000000-0000-4000-8000-000000000001",
      runId: "00000000-0000-4000-8000-000000000002",
      kind: "research",
      state: "succeeded",
      result: stored,
      payload: { leadId: "00000000-0000-4000-8000-000000000003" },
      attemptCount: 1,
      leaseExpiresAt: null,
      leaseTokenDigest: digestLeaseToken(leaseToken),
    }]);

    await expect(completeJob({ execute } as unknown as LeadHunterJobDatabase, {
      id: "00000000-0000-4000-8000-000000000001",
      leaseToken,
      now: new Date("2026-09-30T12:00:00.000Z"),
      maxAttempts: 3,
      completion: { result: stored },
    })).rejects.toBeInstanceOf(JobCompletionValidationError);

    expect(execute).toHaveBeenCalledOnce();
  });

  it.each(["audit_website", "qualify"] as const)(
    "rejects generic successful %s completion before any write",
    async (kind) => {
      const execute = vi.fn(async () => [{
        id: "00000000-0000-4000-8000-000000000001",
        runId: "00000000-0000-4000-8000-000000000002",
        kind,
        state: "leased",
        result: null,
        payload: { leadId: "00000000-0000-4000-8000-000000000003" },
        attemptCount: 1,
        leaseExpiresAt: "2026-09-30T12:10:00.000Z",
        leaseTokenDigest: digestLeaseToken(leaseToken),
      }]);

      await expect(completeJob({ execute } as unknown as LeadHunterJobDatabase, {
        id: "00000000-0000-4000-8000-000000000001",
        leaseToken,
        now: new Date("2026-09-30T12:00:00.000Z"),
        maxAttempts: 3,
        completion: { result: { kind, output: {} } },
      })).rejects.toBeInstanceOf(JobCompletionValidationError);

      expect(execute).toHaveBeenCalledOnce();
    },
  );

  it("rejects generic successful research completion before any write", async () => {
    const execute = vi.fn(async () => [{
      id: "00000000-0000-4000-8000-000000000001",
      runId: "00000000-0000-4000-8000-000000000002",
      kind: "research",
      state: "leased",
      result: null,
      payload: { leadId: "00000000-0000-4000-8000-000000000003" },
      attemptCount: 1,
      leaseExpiresAt: "2026-09-30T12:10:00.000Z",
      leaseTokenDigest: digestLeaseToken(leaseToken),
    }]);
    const evidenceIds = Array.from(
      { length: 50 },
      (_, index) => `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    );

    await expect(completeJob({ execute } as unknown as LeadHunterJobDatabase, {
      id: "00000000-0000-4000-8000-000000000001",
      leaseToken,
      now: new Date("2026-09-30T12:00:00.000Z"),
      maxAttempts: 3,
      completion: { result: { kind: "research", output: { evidenceIds } } },
    })).rejects.toBeInstanceOf(JobCompletionValidationError);

    expect(execute).toHaveBeenCalledOnce();
  });

  it("rejects more evidence IDs than the worker can return", async () => {
    const execute = vi.fn(async () => [{
      id: "00000000-0000-4000-8000-000000000001",
      runId: "00000000-0000-4000-8000-000000000002",
      kind: "research",
      state: "leased",
      result: null,
      payload: { leadId: "00000000-0000-4000-8000-000000000003" },
      attemptCount: 1,
      leaseExpiresAt: "2026-09-30T12:10:00.000Z",
      leaseTokenDigest: digestLeaseToken(leaseToken),
    }]);

    await expect(completeJob({ execute } as unknown as LeadHunterJobDatabase, {
      id: "00000000-0000-4000-8000-000000000001",
      leaseToken,
      now: new Date("2026-09-30T12:00:00.000Z"),
      maxAttempts: 3,
      completion: {
        result: {
          kind: "research",
          output: {
            evidenceIds: Array.from(
              { length: 51 },
              (_, index) => `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
            ),
          },
        },
      },
    })).rejects.toBeInstanceOf(JobCompletionValidationError);

    expect(execute).toHaveBeenCalledOnce();
  });
});
