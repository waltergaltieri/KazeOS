// @vitest-environment node

import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));
vi.mock("server-only", () => ({}));

import { createResponseClient } from "./response";

describe("createResponseClient", () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
    createServerClientMock.mockReturnValue({ auth: {} });
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "sb_publishable_example";
  });

  it("propagates every Supabase cookie and response header", () => {
    const request = new NextRequest("https://app.local/dashboard");
    const initialResponse = NextResponse.next({ request });
    const adapter = createResponseClient(request, initialResponse);
    const options = createServerClientMock.mock.calls[0]?.[2] as {
      cookies: {
        setAll: (
          cookies: Array<{
            name: string;
            value: string;
            options: { httpOnly?: boolean; path?: string };
          }>,
          headers: Record<string, string>,
        ) => void;
      };
    };

    options.cookies.setAll(
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

    const response = adapter.getResponse();

    expect(response.cookies.get("sb-session")?.value).toBe("refreshed");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-supabase-refresh")).toBe("preserved");
  });

  it("carries every Supabase cookie and header onto a redirect response", () => {
    const request = new NextRequest("https://app.local/clients");
    const adapter = createResponseClient(request);
    const options = createServerClientMock.mock.calls[0]?.[2] as {
      cookies: {
        setAll: (
          cookies: Array<{
            name: string;
            value: string;
            options: { sameSite?: "lax" };
          }>,
          headers: Record<string, string>,
        ) => void;
      };
    };

    options.cookies.setAll(
      [
        {
          name: "sb-session",
          value: "refreshed",
          options: { sameSite: "lax" },
        },
      ],
      {
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
      },
    );

    const redirect = adapter.applyTo(
      NextResponse.redirect(new URL("/login", request.url)),
    );

    expect(redirect.cookies.get("sb-session")?.value).toBe("refreshed");
    expect(redirect.headers.get("cache-control")).toBe("private, no-store");
    expect(redirect.headers.get("vary")).toBe("Cookie");
  });
});
