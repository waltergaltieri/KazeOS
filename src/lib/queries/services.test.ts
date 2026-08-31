import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  withAuthenticatedDb: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));

import { getServiceById, getServices } from "./services";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const serviceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("service queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: ownerId });
    mocks.withAuthenticatedDb.mockResolvedValue([]);
  });

  it("binds service lists to the verified owner", async () => {
    await getServices(clientId, "2026-08-31");

    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledWith(
      ownerId,
      expect.any(Function),
    );
  });

  it("rejects malformed ids and dates before opening a database scope", async () => {
    await expect(getServices("not-an-id", "2026-08-31")).rejects.toThrow();
    await expect(getServices(clientId, "2026-02-30")).rejects.toThrow();
    await expect(getServiceById(clientId, "not-an-id")).rejects.toThrow();
    expect(mocks.withAuthenticatedDb).not.toHaveBeenCalled();
  });

  it("accepts an owned client and service scope", async () => {
    await getServiceById(clientId, serviceId);
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledWith(
      ownerId,
      expect.any(Function),
    );
  });
});
