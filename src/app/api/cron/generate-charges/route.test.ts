// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateRecurringCharges: vi.fn(),
  generateRecurringExpenses: vi.fn(),
  runRecurringChargeCron: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/db/internal/admin", () => ({
  adminDb: { transaction: mocks.transaction },
}));
vi.mock("@/lib/services/charge-generator", () => ({
  generateRecurringCharges: mocks.generateRecurringCharges,
}));
vi.mock("@/lib/services/expense-generator", () => ({
  generateRecurringExpenses: mocks.generateRecurringExpenses,
}));

import { runRecurringChargeCron as runCombinedRecurringCron } from "@/db";

const cronSecret = "local-test-cron-secret-32-characters";
const originalCronSecret = process.env.CRON_SECRET;

function request(authorization?: string) {
  const headers = authorization ? { authorization } : undefined;

  return new Request("http://localhost/api/cron/generate-charges", { headers });
}

async function invokeGet(requestValue: Request) {
  const { GET } = await import("./route");
  return GET(requestValue);
}

describe("GET /api/cron/generate-charges", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/db", () => ({
      runRecurringChargeCron: mocks.runRecurringChargeCron,
    }));
    process.env.CRON_SECRET = cronSecret;
    vi.clearAllMocks();
    mocks.runRecurringChargeCron.mockReset();
    mocks.transaction.mockReset();
    mocks.transaction.mockImplementation(
      (operation: (transaction: object) => unknown) =>
        operation({ kind: "transaction" }),
    );
  });

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it.each([
    undefined,
    `bearer ${cronSecret}`,
    `Bearer  ${cronSecret}`,
    `Bearer ${cronSecret}x`,
    "Bearer wrong-secret",
  ])("rejects a non-exact authorization value %#", async (authorization) => {
    const response = await invokeGet(request(authorization));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.runRecurringChargeCron).not.toHaveBeenCalled();
  });

  it("reports unavailable when the server secret is absent", async () => {
    delete process.env.CRON_SECRET;

    const response = await invokeGet(request(`Bearer ${cronSecret}`));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Cron is not configured" });
    expect(mocks.runRecurringChargeCron).not.toHaveBeenCalled();
  });

  it("runs the protected generator and returns useful counts", async () => {
    mocks.runRecurringChargeCron.mockResolvedValue({
      candidates: 5,
      eligibleServices: 2,
      inserted: 3,
      skipped: 2,
      expenses: {
        candidates: 4,
        eligibleTemplates: 2,
        inserted: 3,
        skipped: 1,
      },
    });

    const response = await invokeGet(request(`Bearer ${cronSecret}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      candidates: 5,
      eligibleServices: 2,
      inserted: 3,
      skipped: 2,
      expenses: {
        candidates: 4,
        eligibleTemplates: 2,
        inserted: 3,
        skipped: 1,
      },
    });
    expect(mocks.runRecurringChargeCron).toHaveBeenCalledOnce();
    expect(mocks.runRecurringChargeCron).toHaveBeenCalledWith(expect.any(String));
  });

  it("returns a safe error without exposing the configured secret", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.runRecurringChargeCron.mockRejectedValue(
      new Error(`database failed for ${cronSecret}`),
    );

    const response = await invokeGet(request(`Bearer ${cronSecret}`));
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

describe("runRecurringChargeCron", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateRecurringCharges.mockReset();
    mocks.generateRecurringExpenses.mockReset();
    mocks.transaction.mockReset();
    mocks.transaction.mockImplementation(
      (operation: (transaction: object) => unknown) =>
        operation({ kind: "transaction" }),
    );
    mocks.generateRecurringCharges.mockResolvedValue({
      candidates: 5,
      eligibleServices: 2,
      inserted: 3,
      skipped: 2,
    });
    mocks.generateRecurringExpenses.mockResolvedValue({
      candidates: 4,
      eligibleTemplates: 2,
      inserted: 3,
      skipped: 1,
    });
  });

  it("preserves charge counts and adds expense counts in the same transaction", async () => {
    await expect(runCombinedRecurringCron("2026-09-02")).resolves.toEqual({
      candidates: 5,
      eligibleServices: 2,
      inserted: 3,
      skipped: 2,
      expenses: {
        candidates: 4,
        eligibleTemplates: 2,
        inserted: 3,
        skipped: 1,
      },
    });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.generateRecurringCharges).toHaveBeenCalledWith(
      { kind: "transaction" },
      { asOf: "2026-09-02", horizonMonths: 3 },
    );
    expect(mocks.generateRecurringExpenses).toHaveBeenCalledWith(
      { kind: "transaction" },
      { asOf: "2026-09-02", horizonMonths: 3 },
    );
  });
});
