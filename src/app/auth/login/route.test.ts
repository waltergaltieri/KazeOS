// @vitest-environment node

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerClientMock, signInWithPasswordMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
  signInWithPasswordMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));

import { POST } from "./route";

type CookieAdapter = {
  setAll: (
    cookies: Array<{
      name: string;
      value: string;
      options: { httpOnly?: boolean; path?: string };
    }>,
    headers: Record<string, string>,
  ) => void;
};

function requestWith(
  email: string,
  password: string,
  origin: string | null = "https://app.local",
) {
  const form = new FormData();
  form.set("email", email);
  form.set("password", password);
  return new NextRequest("https://app.local/auth/login", {
    method: "POST",
    body: form,
    headers: origin ? { Origin: origin } : undefined,
  });
}

describe("POST /auth/login", () => {
  let cookieAdapter: CookieAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      "sb_publishable_example";
    process.env.APP_ORIGIN = "https://app.local";
    signInWithPasswordMock.mockResolvedValue({ error: null });
    createServerClientMock.mockImplementation(
      (_url: string, _key: string, options: { cookies: CookieAdapter }) => {
        cookieAdapter = options.cookies;
        return { auth: { signInWithPassword: signInWithPasswordMock } };
      },
    );
  });

  it.each([
    ["a foreign Origin", "https://evil.example"],
    ["a missing Origin", null],
  ])("rejects %s before parsing credentials or creating Supabase", async (_label, origin) => {
    const request = requestWith(
      "agustin@example.com",
      "valid-password",
      origin,
    );
    const formDataSpy = vi.spyOn(request, "formData");

    const response = await POST(request);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      status: "error",
      message: "Solicitud no permitida.",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  it("fails closed when the trusted canonical origin is not configured", async () => {
    delete process.env.APP_ORIGIN;

    const response = await POST(
      requestWith("agustin@example.com", "valid-password"),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it("rejects malformed credentials before creating a Supabase client", async () => {
    const response = await POST(requestWith("not-an-email", "short"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      status: "error",
      message: "Revisá el email y la contraseña.",
      fieldErrors: {
        email: "Ingresá un email válido.",
        password: "La contraseña debe tener al menos 8 caracteres.",
      },
    });
    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("writes every Supabase cookie and header on successful login", async () => {
    signInWithPasswordMock.mockImplementation(async () => {
      cookieAdapter.setAll(
        [
          {
            name: "sb-session",
            value: "authenticated",
            options: { httpOnly: true, path: "/" },
          },
        ],
        {
          "Cache-Control": "private, no-store",
          Expires: "0",
          Pragma: "no-cache",
          "X-Supabase-Auth": "login",
        },
      );
      return { error: null };
    });

    const response = await POST(
      requestWith(" Agustin@Example.com ", "valid-password"),
    );

    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "agustin@example.com",
      password: "valid-password",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ redirectTo: "/dashboard" });
    expect(response.cookies.get("sb-session")?.value).toBe("authenticated");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("expires")).toBe("0");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("x-supabase-auth")).toBe("login");
  });

  it("returns a safe no-store response when the provider rejects login", async () => {
    signInWithPasswordMock.mockResolvedValue({
      error: new Error("private provider diagnostic"),
    });

    const response = await POST(
      requestWith("agustin@example.com", "valid-password"),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      status: "error",
      message: "No pudimos iniciar sesión. Verificá tus datos e intentá de nuevo.",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
  });

  it("returns a safe no-store response when the auth client cannot be created", async () => {
    createServerClientMock.mockImplementation(() => {
      throw new Error("private configuration diagnostic");
    });

    const response = await POST(
      requestWith("agustin@example.com", "valid-password"),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "error",
      message: "No pudimos iniciar sesión. Verificá tus datos e intentá de nuevo.",
    });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
  });
});
