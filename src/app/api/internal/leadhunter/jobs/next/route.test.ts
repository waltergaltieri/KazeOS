// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClaimedJob } from "@/lib/services/leadhunter/job-manager";

const mocks = vi.hoisted(() => ({
  claimLeadHunterJob: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({
  claimLeadHunterJob: mocks.claimLeadHunterJob,
}));

const secret = "worker-secret-with-enough-entropy";
const originalSecret = process.env.LEADHUNTER_WORKER_SECRET;

function request(body: string, authorization = `Bearer ${secret}`) {
  return new Request("http://localhost/api/internal/leadhunter/jobs/next", {
    body,
    headers: {
      authorization,
      "content-type": "application/json",
    },
    method: "POST",
  });
}

async function invokePost(requestValue: Request) {
  const { POST } = await import("./route");
  return POST(requestValue);
}

describe("POST /api/internal/leadhunter/jobs/next", () => {
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

  it.each([
    `bearer ${secret}`,
    `Bearer  ${secret}`,
    `Bearer ${secret}x`,
    "Bearer wrong-secret",
  ])("rejects a near-match worker credential %#", async (authorization) => {
    const response = await invokePost(request("{}", authorization));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.claimLeadHunterJob).not.toHaveBeenCalled();
  });

  it("validates the JSON body before claiming", async () => {
    const response = await invokePost(request('{"ownerId":"untrusted"}'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request" });
    expect(mocks.claimLeadHunterJob).not.toHaveBeenCalled();
  });

  it("returns the narrow claimed-job contract without accepting an owner id", async () => {
    const claimedJob = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "discover" as const,
      leaseToken: "random-token",
      leaseExpiresAt: "2026-09-30T12:05:00.000Z",
      payload: { query: "distribuidores" },
    } satisfies ClaimedJob;
    mocks.claimLeadHunterJob.mockResolvedValue(claimedJob);

    const response = await invokePost(request("{}"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "discover",
      leaseToken: "random-token",
      leaseExpiresAt: "2026-09-30T12:05:00.000Z",
      payload: { query: "distribuidores" },
    });
    expect(mocks.claimLeadHunterJob).toHaveBeenCalledOnce();
    expect(mocks.claimLeadHunterJob.mock.calls[0]).toHaveLength(0);
  });

  it("returns 204 when there is no claimable work", async () => {
    mocks.claimLeadHunterJob.mockResolvedValue(null);

    const response = await invokePost(request("{}"));

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
  });

  it("keeps secrets out of internal errors and logs", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.claimLeadHunterJob.mockRejectedValue(
      new Error(`database failed using ${secret}`),
    );

    const response = await invokePost(request("{}"));
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(body).toBe(JSON.stringify({ error: "Job claim failed" }));
    expect(body).not.toContain(secret);
    expect(consoleError).toHaveBeenCalledWith("LeadHunter job claim failed");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
    consoleError.mockRestore();
  });
});
