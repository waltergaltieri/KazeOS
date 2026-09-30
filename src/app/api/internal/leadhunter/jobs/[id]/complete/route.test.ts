// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  completeLeadHunterJob: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({
  completeLeadHunterJob: mocks.completeLeadHunterJob,
}));

const secret = "worker-secret-with-enough-entropy";
const jobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const originalSecret = process.env.LEADHUNTER_WORKER_SECRET;

function request(body: string, authorization = `Bearer ${secret}`) {
  return new Request(
    `http://localhost/api/internal/leadhunter/jobs/${jobId}/complete`,
    {
      body,
      headers: {
        authorization,
        "content-type": "application/json",
      },
      method: "POST",
    },
  );
}

async function invokePost(requestValue: Request, id = jobId) {
  const { POST } = await import("./route");
  return POST(requestValue, { params: Promise.resolve({ id }) });
}

describe("POST /api/internal/leadhunter/jobs/[id]/complete", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.LEADHUNTER_WORKER_SECRET = secret;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.LEADHUNTER_WORKER_SECRET;
    } else {
      process.env.LEADHUNTER_WORKER_SECRET = originalSecret;
    }
  });

  it("rejects near-match credentials before reading completion data", async () => {
    const response = await invokePost(
      request("{}", `Bearer ${secret}x`),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.completeLeadHunterJob).not.toHaveBeenCalled();
  });

  it.each([
    ["not-a-uuid", '{"leaseToken":"token","result":{}}'],
    [jobId, "not-json"],
    [jobId, '{"ownerId":"untrusted","leaseToken":"token","result":{}}'],
    [jobId, '{"leaseToken":"","result":{}}'],
    [jobId, '{"leaseToken":"token","result":{},"error":"both"}'],
  ])("rejects invalid id or JSON %#", async (id, body) => {
    const response = await invokePost(request(body), id);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
    expect(mocks.completeLeadHunterJob).not.toHaveBeenCalled();
  });

  it("passes only job id, lease token and completion to the manager", async () => {
    const result = {
      kind: "discover",
      output: { candidateCount: 2 },
    };
    mocks.completeLeadHunterJob.mockResolvedValue({
      status: "succeeded",
      result,
    });

    const response = await invokePost(request(JSON.stringify({
      leaseToken: "lease-token",
      result,
    })));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "succeeded", result });
    expect(mocks.completeLeadHunterJob).toHaveBeenCalledWith({
      id: jobId,
      leaseToken: "lease-token",
      completion: { result },
    });
  });

  it("returns the stored result for a duplicate completion", async () => {
    const stored = {
      kind: "discover",
      output: { candidateCount: 2 },
    };
    mocks.completeLeadHunterJob.mockResolvedValue({
      status: "succeeded",
      result: stored,
    });

    const response = await invokePost(request(JSON.stringify({
      leaseToken: "lease-token",
      result: { kind: "discover", output: { candidateCount: 999 } },
    })));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "succeeded",
      result: stored,
    });
  });

  it.each([
    [
      "valid research envelope",
      {
        source_url: "https://example.com/about",
        source_type: "official_site",
        supplied_at: "2026-09-30T12:00:00.000Z",
        content_sha256: "a".repeat(64),
        findings: [],
        diagnostics: [],
        usage: {
          extractor: "offline-v1",
          elapsed_ms: 1,
          model_calls: 0,
          input_tokens: 0,
          output_tokens: 0,
          estimated_cost_usd: 0,
        },
      },
      { status: "processed", evidenceIds: [] },
    ],
    [
      "malformed research envelope",
      { sendMail: true },
      { status: "rejected", evidenceIds: [], rejectedCount: 1 },
    ],
  ])("passes a %s to the trusted completion service", async (_name, result, stored) => {
    mocks.completeLeadHunterJob.mockResolvedValue(stored);

    const response = await invokePost(request(JSON.stringify({
      leaseToken: "raw-research-token",
      result,
    })));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(stored);
    expect(mocks.completeLeadHunterJob).toHaveBeenCalledWith({
      id: jobId,
      leaseToken: "raw-research-token",
      completion: { result },
    });
  });

  it("maps a wrong research lease without exposing token or output", async () => {
    const { JobCompletionRejectedError } =
      await import("@/lib/services/leadhunter/job-manager");
    mocks.completeLeadHunterJob.mockRejectedValue(new JobCompletionRejectedError());
    const output = { source_url: "https://example.com", findings: [] };

    const response = await invokePost(request(JSON.stringify({
      leaseToken: "wrong-research-token",
      result: output,
    })));

    expect(response.status).toBe(409);
    const body = JSON.stringify(await response.json());
    expect(body).toBe(JSON.stringify({ error: "Job completion rejected" }));
    expect(body).not.toContain("wrong-research-token");
    expect(body).not.toContain("source_url");
  });

  it("maps a generic evidence-id submission to an invalid result", async () => {
    const { JobCompletionValidationError } =
      await import("@/lib/services/leadhunter/job-manager");
    mocks.completeLeadHunterJob.mockRejectedValue(new JobCompletionValidationError());

    const response = await invokePost(request(JSON.stringify({
      leaseToken: "raw-research-token",
      result: { kind: "research", output: { evidenceIds: [] } },
    })));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid job result" });
  });

  it("maps rejected or invalid completions to generic responses", async () => {
    const { JobCompletionRejectedError, JobCompletionValidationError } =
      await import("@/lib/services/leadhunter/job-manager");

    mocks.completeLeadHunterJob.mockRejectedValueOnce(
      new JobCompletionRejectedError(),
    );
    const rejected = await invokePost(request(JSON.stringify({
      leaseToken: "lease-token",
      result: { kind: "discover", output: {} },
    })));
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({ error: "Job completion rejected" });

    mocks.completeLeadHunterJob.mockRejectedValueOnce(
      new JobCompletionValidationError(),
    );
    const invalid = await invokePost(request(JSON.stringify({
      leaseToken: "lease-token",
      result: { kind: "discover", output: {} },
    })));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Invalid job result" });
  });

  it("keeps secrets out of internal errors and logs", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.completeLeadHunterJob.mockRejectedValue(
      new Error(`database failed using ${secret}`),
    );

    const response = await invokePost(request(JSON.stringify({
      leaseToken: "lease-token",
      error: "worker failed",
    })));
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(body).toBe(JSON.stringify({ error: "Job completion failed" }));
    expect(body).not.toContain(secret);
    expect(consoleError).toHaveBeenCalledWith("LeadHunter job completion failed");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
    consoleError.mockRestore();
  });
});
