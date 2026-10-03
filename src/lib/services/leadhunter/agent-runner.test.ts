// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  claimNextJob: vi.fn(),
  completeJob: vi.fn(),
  resolveSourceCandidateIdentity: vi.fn(),
}));

vi.mock("./job-manager", () => ({
  claimNextJob: mocks.claimNextJob,
  completeJob: mocks.completeJob,
}));

vi.mock("./identity-manager", () => ({
  resolveSourceCandidateIdentity: mocks.resolveSourceCandidateIdentity,
}));

import { runAgentIdentityResolution } from "./agent-runner";

describe("LeadHunter agent identity resolution", () => {
  it("uses the identity persisted by the discovery adapter", async () => {
    const identity = {
      name: "Example Mayorista",
      emails: [],
      urls: [{ url: "https://example.com/", role: "official_website" }],
      location: {},
      organizationRole: "unknown",
    };
    mocks.claimNextJob
      .mockResolvedValueOnce({
        id: "00000000-0000-4000-8000-000000000010",
        ownerId: "00000000-0000-4000-8000-000000000001",
        runId: "00000000-0000-4000-8000-000000000002",
        kind: "resolve_identity",
        leaseToken: "lease-token",
        payload: { candidateId: "00000000-0000-4000-8000-000000000003" },
      });
    mocks.resolveSourceCandidateIdentity.mockResolvedValue({
      leadId: null,
      resolutionState: "needs_review",
      outboundProtection: { blocked: false, reason: null },
    });
    mocks.completeJob.mockResolvedValue({ status: "succeeded" });
    const database = {
      transaction: vi.fn(async (operation: (database: unknown) => Promise<unknown>) => operation(database)),
      execute: vi.fn(async () => [{
        canonicalUrl: "https://example.com/",
        sourceType: "web_search",
        rawRecord: {
          observedName: "Example Mayorista",
          observedLocation: null,
          metadata: { identity },
        },
        campaignId: "00000000-0000-4000-8000-000000000004",
        campaignVersion: 1,
        snapshot: { countries: ["AR"], strategy: { research: { questions: [] } } },
      }]),
    };

    await runAgentIdentityResolution(database as never, 1);

    expect(mocks.resolveSourceCandidateIdentity).toHaveBeenCalledWith(
      database,
      expect.objectContaining({ observation: identity }),
    );
  });
});
