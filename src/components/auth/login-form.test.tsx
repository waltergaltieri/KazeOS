import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "./login-form";

const { replaceMock, refreshMock } = vi.hoisted(() => ({
  replaceMock: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, refresh: refreshMock }),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes labeled email and password controls", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute(
      "type",
      "password",
    );
    expect(
      screen.getByRole("button", { name: "Iniciar sesión" }),
    ).toBeEnabled();
  });

  it("allows revealing and hiding the password with an accessible control", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    const password = screen.getByLabelText("Contraseña");
    const toggle = screen.getByRole("button", { name: "Mostrar contraseña" });

    await user.click(toggle);
    expect(password).toHaveAttribute("type", "text");
    expect(toggle).toHaveAccessibleName("Ocultar contraseña");
  });

  it("posts credentials and shows only the safe server error", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "error",
          message:
            "No pudimos iniciar sesión. Verificá tus datos e intentá de nuevo.",
        }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<LoginForm redirectTo="/clients/new" />);

    await user.type(screen.getByLabelText("Email"), "agustin@example.com");
    await user.type(
      screen.getByLabelText("Contraseña"),
      "valid-password",
    );
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/auth/login",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as { body: FormData };
    expect(request.body.get("email")).toBe("agustin@example.com");
    expect(request.body.get("next")).toBe("/clients/new");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos iniciar sesión. Verificá tus datos e intentá de nuevo.",
    );
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it.each(["//evil.example", "/\\evil.example"])(
    "rejects unsafe redirect path %s from a successful response",
    async (unsafePath) => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ redirectTo: unsafePath }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    render(<LoginForm />);

    await user.type(screen.getByLabelText("Email"), "agustin@example.com");
    await user.type(
      screen.getByLabelText("Contraseña"),
      "valid-password",
    );
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(replaceMock).toHaveBeenCalledWith("/dashboard");
    expect(refreshMock).toHaveBeenCalledOnce();
    },
  );
});
