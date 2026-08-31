import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), withAuthenticatedDb: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));

import { getClientNotes } from "./client-notes";

describe("getClientNotes", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireUser.mockResolvedValue({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }); mocks.withAuthenticatedDb.mockResolvedValue([]); });
  it("opens an authenticated owner-scoped read only after validating the client", async () => {
    await getClientNotes("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledWith("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expect.any(Function));
    await expect(getClientNotes("not-a-client")).rejects.toThrow();
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledTimes(1);
  });
});
