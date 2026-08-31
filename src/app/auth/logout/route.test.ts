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

function trustedLogoutRequest() {
  return new NextRequest("https://app.local/auth/logout", {
    method: "POST",
    headers: { Origin: "https://app.local" },
  });
}

describe("POST /auth/logout", () => {
  let cookieAdapter: CookieAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "sb_publishable_example";
    process.env.APP_ORIGIN = "https://app.local";
    signOutMock.mockResolvedValue({ error: null });
    createServerClientMock.mockImplementation(
      (_url: string, _key: string, options: { cookies: CookieAdapter }) => {
        cookieAdapter = options.cookies;
        return { auth: { signOut: signOutMock } };
      },
    );
  });

  it.each([
    ["a foreign Origin", "https://evil.example"],
    ["a missing Origin", null],
  ])("rejects %s before creating or calling Supabase", async (_label, origin) => {
    const response = await POST(
      new NextRequest("https://app.local/auth/logout", {
        method: "POST",
        headers: origin ? { Origin: origin } : undefined,
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      status: "error",
      message: "Solicitud no permitida.",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("fails closed when the trusted canonical origin is malformed", async () => {
    process.env.APP_ORIGIN = "https://app.local/path";

    const response = await POST(
      new NextRequest("https://app.local/auth/logout", {
        method: "POST",
        headers: { Origin: "https://app.local" },
      }),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(createServerClientMock).not.toHaveBeenCalled();
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

    const response = await POST(trustedLogoutRequest());

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

    const response = await POST(trustedLogoutRequest());

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

    const response = await POST(trustedLogoutRequest());

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.local/login");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
  });
});
