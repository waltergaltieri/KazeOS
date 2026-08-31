import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  withAuthenticatedDb: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));

import { getClientById, getClients } from "./clients";

describe("client queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    mocks.withAuthenticatedDb.mockResolvedValue([]);
  });

  it("binds list reads to the verified user", async () => {
    await getClients({ search: " Norte ", filter: "active" });

    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledWith(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expect.any(Function),
    );
  });

  it("rejects malformed identifiers before opening a database scope", async () => {
    await expect(getClientById("not-an-id")).rejects.toThrow();
    expect(mocks.withAuthenticatedDb).not.toHaveBeenCalled();
  });
});
