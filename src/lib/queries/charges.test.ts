import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), withAuthenticatedDb: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));

import { getChargeById, getChargeFilterOptions, getCharges } from "./charges";

describe("charge queries", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireUser.mockResolvedValue({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }); mocks.withAuthenticatedDb.mockResolvedValue([]); });
  it("binds list reads to the verified user", async () => {
    await getCharges({ status: "overdue" }, "2026-08-31");
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledWith("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expect.any(Function));
  });
  it("rejects malformed identifiers before opening a database scope", async () => {
    await expect(getChargeById("bad", "2026-08-31")).rejects.toThrow();
    expect(mocks.withAuthenticatedDb).not.toHaveBeenCalled();
  });
  it("loads client and service filter options inside the verified owner scope", async () => {
    await getChargeFilterOptions();
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expect.any(Function),
    );
  });
});
