import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), withAuthenticatedDb: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));

import { getSettings } from "./settings";

describe("getSettings", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireUser.mockResolvedValue({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "admin@example.com" }); mocks.withAuthenticatedDb.mockResolvedValue({ profile: { fullName: "Agustín", email: "stale@example.com" }, business: null }); });
  it("uses verified identity and returns Argentina defaults without persisting on read", async () => {
    await expect(getSettings()).resolves.toEqual({
      profile: { fullName: "Agustín", email: "admin@example.com" },
      business: { primaryCurrency: "USD", timezone: "America/Argentina/Buenos_Aires", locale: "es-AR", businessName: null, businessInfo: null },
    });
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledWith("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expect.any(Function));
  });
});
