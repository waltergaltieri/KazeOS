import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const { useThemeMock } = vi.hoisted(() => ({ useThemeMock: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("next-themes", () => ({ useTheme: useThemeMock }));
vi.mock("@/lib/auth/actions", () => ({ logout: vi.fn() }));

import { AppShell } from "./app-shell";

describe("AppShell", () => {
  it("grounds the page with ledger navigation and verified user context", () => {
    useThemeMock.mockReturnValue({ theme: "system", setTheme: vi.fn() });

    render(
      <AppShell
        user={{ name: "Agustín Pérez", email: "agustin@example.com" }}
      >
        <h1>Resumen diario</h1>
      </AppShell>,
    );

    expect(screen.getByRole("navigation", { name: "Principal" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Dashboard", current: "page" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Agustín Pérez")).toBeVisible();
    expect(screen.getByText("agustin@example.com")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Resumen diario" })).toBeVisible();
  });

  it("opens and closes an accessible mobile navigation drawer", async () => {
    const user = userEvent.setup();
    useThemeMock.mockReturnValue({ theme: "system", setTheme: vi.fn() });
    render(
      <AppShell user={{ name: "Agustín", email: "agustin@example.com" }}>
        Contenido
      </AppShell>,
    );

    await user.click(
      screen.getByRole("button", { name: "Abrir menú principal" }),
    );
    expect(screen.getByRole("dialog", { name: "Menú principal" })).toBeVisible();

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Menú principal" }),
    ).not.toBeInTheDocument();
  });

  it("offers quick creation and all three theme modes", async () => {
    const user = userEvent.setup();
    const setTheme = vi.fn();
    useThemeMock.mockReturnValue({ theme: "system", setTheme });
    render(
      <AppShell user={{ name: "Agustín", email: "agustin@example.com" }}>
        Contenido
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Creación rápida" }));
    expect(screen.getByRole("menuitem", { name: "Nuevo cliente" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Nuevo cobro" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Nueva tarea" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Tema" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Oscuro" }));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });
});
