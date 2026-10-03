// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  planDueLeadHunterRuns: vi.fn(),
  runLeadHunterIdentityResolution: vi.fn(),
  runLeadHunterMessagePreparation: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({
  planDueLeadHunterRuns: mocks.planDueLeadHunterRuns,
  runLeadHunterIdentityResolution: mocks.runLeadHunterIdentityResolution,
  runLeadHunterMessagePreparation: mocks.runLeadHunterMessagePreparation,
}));

const secret = "cron-secret-with-enough-entropy";
const originalSecret = process.env.CRON_SECRET;

function request(authorization?: string) {
  return new Request("http://localhost/api/cron/leadhunter", {
    headers: authorization ? { authorization } : undefined,
  });
}

async function invokeGet(requestValue: Request) {
  const { GET } = await import("./route");
  return GET(requestValue);
}

describe("GET /api/cron/leadhunter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.CRON_SECRET = secret;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it.each([
    undefined,
    `bearer ${secret}`,
    `Bearer  ${secret}`,
    `Bearer ${secret}x`,
    "Bearer wrong-secret",
  ])("rejects a non-exact cron credential %#", async (authorization) => {
    const response = await invokeGet(request(authorization));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.planDueLeadHunterRuns).not.toHaveBeenCalled();
  });

  it("uses CRON_SECRET rather than the worker secret", async () => {
    process.env.LEADHUNTER_WORKER_SECRET = "different-worker-secret";
    const response = await invokeGet(
      request(`Bearer ${process.env.LEADHUNTER_WORKER_SECRET}`),
    );

    expect(response.status).toBe(401);
    expect(mocks.planDueLeadHunterRuns).not.toHaveBeenCalled();
  });

  it("plans due campaigns and processes identity without running web discovery", async () => {
    mocks.planDueLeadHunterRuns.mockResolvedValue({
      dueCampaigns: 2,
      createdRuns: 1,
      createdJobs: 4,
    });
    mocks.runLeadHunterIdentityResolution.mockResolvedValue({ processed: 3, failed: 0 });
    mocks.runLeadHunterMessagePreparation.mockResolvedValue({ processed: 2, failed: 0 });

    const response = await invokeGet(request(`Bearer ${secret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      planned: { dueCampaigns: 2, createdRuns: 1, createdJobs: 4 },
      identity: { processed: 3, failed: 0 },
      messages: { processed: 2, failed: 0 },
    });
    expect(mocks.planDueLeadHunterRuns).toHaveBeenCalledOnce();
    expect(mocks.planDueLeadHunterRuns.mock.calls[0]).toHaveLength(0);
    expect(mocks.runLeadHunterIdentityResolution).toHaveBeenCalledOnce();
    expect(mocks.runLeadHunterMessagePreparation).toHaveBeenCalledOnce();
  });

  it("keeps secrets out of internal errors and logs", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.planDueLeadHunterRuns.mockRejectedValue(
      new Error(`database failed using ${secret}`),
    );

    const response = await invokeGet(request(`Bearer ${secret}`));
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(body).toBe(JSON.stringify({ error: "LeadHunter planning failed" }));
    expect(body).not.toContain(secret);
    expect(consoleError).toHaveBeenCalledWith("LeadHunter planning failed");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
    consoleError.mockRestore();
  });
});
