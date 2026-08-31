// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runRecurringChargeCron } = vi.hoisted(() => ({
  runRecurringChargeCron: vi.fn(),
}));

vi.mock("@/db", () => ({ runRecurringChargeCron }));

import { GET } from "./route";

const cronSecret = "local-test-cron-secret-32-characters";

function request(authorization?: string) {
  const headers = authorization ? { authorization } : undefined;

  return new Request("http://localhost/api/cron/generate-charges", { headers });
}

describe("GET /api/cron/generate-charges", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = cronSecret;
    runRecurringChargeCron.mockReset();
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it.each([
    undefined,
    `bearer ${cronSecret}`,
    `Bearer  ${cronSecret}`,
    `Bearer ${cronSecret}x`,
    "Bearer wrong-secret",
  ])("rejects a non-exact authorization value %#", async (authorization) => {
    const response = await GET(request(authorization));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(runRecurringChargeCron).not.toHaveBeenCalled();
  });

  it("reports unavailable when the server secret is absent", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET(request(`Bearer ${cronSecret}`));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Cron is not configured" });
    expect(runRecurringChargeCron).not.toHaveBeenCalled();
  });

  it("runs the protected generator and returns useful counts", async () => {
    runRecurringChargeCron.mockResolvedValue({
      candidates: 5,
      eligibleServices: 2,
      inserted: 3,
      skipped: 2,
    });

    const response = await GET(request(`Bearer ${cronSecret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      candidates: 5,
      eligibleServices: 2,
      inserted: 3,
      skipped: 2,
    });
    expect(runRecurringChargeCron).toHaveBeenCalledOnce();
    expect(runRecurringChargeCron).toHaveBeenCalledWith(expect.any(String));
  });

  it("returns a safe error without exposing the configured secret", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    runRecurringChargeCron.mockRejectedValue(
      new Error(`database failed for ${cronSecret}`),
    );

    const response = await GET(request(`Bearer ${cronSecret}`));
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(500);
    expect(body).toBe(JSON.stringify({ error: "Charge generation failed" }));
    expect(body).not.toContain(cronSecret);
    expect(consoleError).toHaveBeenCalledWith(
      "Recurring charge generation failed",
    );
    consoleError.mockRestore();
  });
});
