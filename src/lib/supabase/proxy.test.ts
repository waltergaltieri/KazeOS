// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));
vi.mock("server-only", () => ({}));

import { updateSession } from "./proxy";

type CookieMethods = {
  setAll: (
    cookies: Array<{
      name: string;
      value: string;
      options: { httpOnly?: boolean; path?: string };
    }>,
    headers: Record<string, string>,
  ) => void;
};

function mockClaims(
  claims: Record<string, unknown> | null,
  onClaims?: (cookies: CookieMethods) => void,
  error: Error | null = null,
) {
  createServerClientMock.mockImplementation(
    (_url: string, _key: string, options: { cookies: CookieMethods }) => ({
      auth: {
        getClaims: async () => {
          onClaims?.(options.cookies);

          return {
            data: claims ? { claims } : null,
            error,
          };
        },
      },
    }),
  );
}

describe("updateSession", () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "sb_publishable_example";
  });

  it("redirects unauthenticated private routes with a safe relative next path", async () => {
    mockClaims(null);

    const response = await updateSession(
      new NextRequest("https://app.local/clients?status=late"),
    );
    const location = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/clients?status=late");
  });

  it("falls back to a safe path for protocol-relative request paths", async () => {
    mockClaims(null);

    const response = await updateSession(
      new NextRequest("https://app.local//evil.example"),
    );
    const location = new URL(response.headers.get("location")!);

    expect(location.searchParams.get("next")).toBe("/dashboard");
  });

  it("redirects authenticated users away from login", async () => {
    mockClaims({ sub: "user-id" });

    const response = await updateSession(
      new NextRequest("https://app.local/login?next=%2Fclients"),
    );

    expect(new URL(response.headers.get("location")!).pathname).toBe(
      "/dashboard",
    );
  });

  it("fails closed when claim verification returns an error", async () => {
    mockClaims({ sub: "untrusted-user-id" }, undefined, new Error("invalid claims"));

    const response = await updateSession(
      new NextRequest("https://app.local/api/private"),
    );

    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });

  it("preserves refreshed cookies and every Supabase header on redirects", async () => {
    mockClaims(null, (cookies) => {
      cookies.setAll(
        [
          {
            name: "sb-session",
            value: "refreshed",
            options: { httpOnly: true, path: "/" },
          },
        ],
        {
          "Cache-Control": "private, no-store",
          "X-Supabase-Refresh": "preserved",
        },
      );
    });

    const response = await updateSession(
      new NextRequest("https://app.local/clients"),
    );

    expect(response.cookies.get("sb-session")?.value).toBe("refreshed");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-supabase-refresh")).toBe("preserved");
  });

  it("allows only the exact charge-generation cron route without a session", async () => {
    const response = await updateSession(
      new NextRequest("https://app.local/api/cron/generate-charges"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("allows only the exact response-capable auth endpoints without a session", async () => {
    for (const path of ["/auth/login", "/auth/logout"]) {
      createServerClientMock.mockClear();
      const response = await updateSession(
        new NextRequest(`https://app.local${path}`, { method: "POST" }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(createServerClientMock).not.toHaveBeenCalled();
    }
  });

  it("keeps near-match auth endpoints protected", async () => {
    mockClaims(null);

    const response = await updateSession(
      new NextRequest("https://app.local/auth/login/extra", { method: "POST" }),
    );

    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });

  it("keeps near-match cron and all other API routes protected", async () => {
    mockClaims(null);

    const response = await updateSession(
      new NextRequest("https://app.local/api/cron/generate-charges/extra"),
    );

    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
  });
});
