// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, createServerClientMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  createServerClientMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));

import { createActionClient, createClient } from "./server";

describe("the Server Component Supabase client", () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
    createServerClientMock.mockReturnValue({ auth: {} });
    cookiesMock.mockResolvedValue({
      getAll: () => [{ name: "sb-session", value: "existing" }],
    });
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "sb_publishable_example";
  });

  it("is explicitly read-only and never registers a cookie writer", async () => {
    await createClient();

    const options = createServerClientMock.mock.calls[0]?.[2] as {
      cookies: { getAll: () => unknown; setAll?: unknown };
    };

    expect(options.cookies.getAll()).toEqual([
      { name: "sb-session", value: "existing" },
    ]);
    expect(options.cookies.setAll).toBeUndefined();
  });

  it("provides a cookie-writing client only for Server Actions", async () => {
    const set = vi.fn();
    cookiesMock.mockResolvedValue({
      getAll: () => [{ name: "sb-session", value: "existing" }],
      set,
    });

    await createActionClient();

    const options = createServerClientMock.mock.calls[0]?.[2] as {
      cookies: {
        setAll: (
          values: Array<{
            name: string;
            value: string;
            options: { httpOnly?: boolean };
          }>,
        ) => void;
      };
    };
    const values = [
      {
        name: "sb-session",
        value: "refreshed",
        options: { httpOnly: true },
      },
    ];

    options.cookies.setAll(values);

    expect(set).toHaveBeenCalledWith("sb-session", "refreshed", {
      httpOnly: true,
    });
  });
});
