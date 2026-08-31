// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createActionClientMock, redirectMock } = vi.hoisted(() => ({
  createActionClientMock: vi.fn(),
  redirectMock: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createActionClient: createActionClientMock,
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { login, logout } from "./actions";

function loginData(email: string, password: string) {
  const data = new FormData();
  data.set("email", email);
  data.set("password", password);
  return data;
}

describe("authentication actions", () => {
  const signInWithPassword = vi.fn();
  const signOut = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    signInWithPassword.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({ error: null });
    createActionClientMock.mockResolvedValue({
      auth: { signInWithPassword, signOut },
    });
  });

  it("rejects malformed credentials before creating a network client", async () => {
    const result = await login(undefined, loginData("not-an-email", "short"));

    expect(result).toEqual({
      status: "error",
      message: "Revisá el email y la contraseña.",
      fieldErrors: {
        email: "Ingresá un email válido.",
        password: "La contraseña debe tener al menos 8 caracteres.",
      },
    });
    expect(createActionClientMock).not.toHaveBeenCalled();
  });

  it("returns a safe message when Supabase rejects the login", async () => {
    signInWithPassword.mockResolvedValue({
      error: new Error("provider diagnostic that must stay private"),
    });

    const result = await login(
      undefined,
      loginData("agustin@example.com", "valid-password"),
    );

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "agustin@example.com",
      password: "valid-password",
    });
    expect(result).toEqual({
      status: "error",
      message: "No pudimos iniciar sesión. Verificá tus datos e intentá de nuevo.",
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("returns the same safe message when the auth request throws", async () => {
    signInWithPassword.mockRejectedValue(new Error("network stack details"));

    await expect(
      login(
        undefined,
        loginData("agustin@example.com", "valid-password"),
      ),
    ).resolves.toEqual({
      status: "error",
      message: "No pudimos iniciar sesión. Verificá tus datos e intentá de nuevo.",
    });
  });

  it("redirects a successful login to the dashboard", async () => {
    await expect(
      login(
        undefined,
        loginData(" Agustin@Example.com ", "valid-password"),
      ),
    ).rejects.toThrow("REDIRECT:/dashboard");

    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "agustin@example.com",
      password: "valid-password",
    });
  });

  it("signs out and redirects to login", async () => {
    await expect(logout()).rejects.toThrow("REDIRECT:/login");

    expect(signOut).toHaveBeenCalledOnce();
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("still redirects safely when remote sign-out fails", async () => {
    signOut.mockRejectedValue(new Error("network stack details"));

    await expect(logout()).rejects.toThrow("REDIRECT:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("still redirects safely when the logout client cannot be created", async () => {
    createActionClientMock.mockRejectedValueOnce(
      new Error("environment stack details"),
    );

    await expect(logout()).rejects.toThrow("REDIRECT:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });
});
