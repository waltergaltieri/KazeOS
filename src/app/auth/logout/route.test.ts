// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerClientMock, signOutMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  signOutMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: createServerClientMock }));

import { POST } from "./route";

type CookieAdapter = {
  setAll: (
    cookies: Array<{
      name: string;
      value: string;
      options: { maxAge?: number; path?: string };
    }>,
    headers: Record<string, string>,
  ) => void;
};

describe("POST /auth/logout", () => {
  let cookieAdapter: CookieAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "sb_publishable_example";
    signOutMock.mockResolvedValue({ error: null });
    createServerClientMock.mockImplementation(
      (_url: string, _key: string, options: { cookies: CookieAdapter }) => {
        cookieAdapter = options.cookies;
        return { auth: { signOut: signOutMock } };
      },
    );
  });

  it("redirects while preserving every Supabase cookie and header", async () => {
    signOutMock.mockImplementation(async () => {
      cookieAdapter.setAll(
        [
          {
            name: "sb-session",
            value: "",
            options: { maxAge: 0, path: "/" },
          },
        ],
        {
          "Cache-Control": "private, no-store",
          Expires: "0",
          Pragma: "no-cache",
          "X-Supabase-Auth": "logout",
        },
      );
      return { error: null };
    });

    const response = await POST(
      new NextRequest("https://app.local/auth/logout", { method: "POST" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.local/login");
    expect(response.cookies.get("sb-session")?.value).toBe("");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-supabase-auth")).toBe("logout");
  });

  it("still returns a safe no-store local redirect when sign-out throws", async () => {
    signOutMock.mockRejectedValue(new Error("private network diagnostic"));

    const response = await POST(
      new NextRequest("https://app.local/auth/logout", { method: "POST" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.local/login");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
  });

  it("still returns a safe local redirect when the auth client cannot be created", async () => {
    createServerClientMock.mockImplementation(() => {
      throw new Error("private configuration diagnostic");
    });

    const response = await POST(
      new NextRequest("https://app.local/auth/logout", { method: "POST" }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.local/login");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
  });
});
