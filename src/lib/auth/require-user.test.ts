// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createClientMock, redirectMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { requireUser } from "./require-user";

describe("requireUser", () => {
  const getUser = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({ auth: { getUser } });
  });

  it("returns the user obtained through verified retrieval", async () => {
    const user = {
      id: "user-id",
      email: "owner@example.com",
      user_metadata: { full_name: "Agustín" },
    };
    getUser.mockResolvedValue({ data: { user }, error: null });

    await expect(requireUser()).resolves.toBe(user);
    expect(getUser).toHaveBeenCalledOnce();
  });

  it("redirects when verified retrieval fails", async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: new Error("expired"),
    });

    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
  });
});
