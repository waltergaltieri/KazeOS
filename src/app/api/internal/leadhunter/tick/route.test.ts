// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  planDueLeadHunterRuns: vi.fn(),
  runLeadHunterIdentityResolution: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => mocks);

const secret = "worker-secret-with-enough-entropy";
const originalSecret = process.env.LEADHUNTER_WORKER_SECRET;

function request(body = "{}", authorization = `Bearer ${secret}`) {
  return new Request("http://localhost/api/internal/leadhunter/tick", {
    method: "POST",
    body,
    headers: { authorization, "content-type": "application/json" },
  });
}

async function invokePost(value: Request) {
  const { POST } = await import("./route");
  return POST(value);
}

describe("POST /api/internal/leadhunter/tick", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.LEADHUNTER_WORKER_SECRET = secret;
    mocks.planDueLeadHunterRuns.mockResolvedValue({ dueCampaigns: 1, createdRuns: 1, createdJobs: 2 });
    mocks.runLeadHunterIdentityResolution.mockResolvedValue({ processed: 3, failed: 0 });
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.LEADHUNTER_WORKER_SECRET;
    else process.env.LEADHUNTER_WORKER_SECRET = originalSecret;
  });

  it("plans due work and resolves discovered identities", async () => {
    const response = await invokePost(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      planned: { dueCampaigns: 1, createdRuns: 1, createdJobs: 2 },
      identity: { processed: 3, failed: 0 },
    });
    expect(mocks.planDueLeadHunterRuns).toHaveBeenCalledOnce();
    expect(mocks.runLeadHunterIdentityResolution).toHaveBeenCalledOnce();
  });

  it("rejects invalid authentication and input", async () => {
    expect((await invokePost(request("{}", "Bearer wrong"))).status).toBe(401);
    expect((await invokePost(request('{"ownerId":"untrusted"}'))).status).toBe(400);
    expect(mocks.planDueLeadHunterRuns).not.toHaveBeenCalled();
  });
});
