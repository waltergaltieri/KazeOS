import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { usePathnameMock, useSearchParamsMock, useThemeMock } = vi.hoisted(() => ({
  usePathnameMock: vi.fn(),
  useSearchParamsMock: vi.fn(),
  useThemeMock: vi.fn(),
}));

function controllableMediaQuery(initialMatches = false) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches: initialMatches,
    media: "(min-width: 980px)",
    onchange: null,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
      listeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };

  return {
    query: query as unknown as MediaQueryList,
    setMatches(matches: boolean) {
      query.matches = matches;
      listeners.forEach((listener) =>
        listener({ matches, media: query.media } as MediaQueryListEvent),
      );
    },
  };
}

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
  useSearchParams: useSearchParamsMock,
}));
vi.mock("next-themes", () => ({ useTheme: useThemeMock }));
vi.mock("@/lib/auth/actions", () => ({ logout: vi.fn() }));

import { AppShell } from "./app-shell";

describe("AppShell", () => {
  beforeEach(() => {
    usePathnameMock.mockReturnValue("/dashboard");
    useSearchParamsMock.mockReturnValue(new URLSearchParams("currency=USD"));
    document.cookie = "kazeos_currency=; Max-Age=0; Path=/";
  });

  it("shows the topbar currency selector on dashboard and expenses index routes", () => {
    useThemeMock.mockReturnValue({ theme: "system", setTheme: vi.fn() });
    const { rerender } = render(
      <AppShell user={{ name: "Agustín", email: "agustin@example.com" }}>
        Contenido
      </AppShell>,
    );

    expect(screen.getByRole("group", { name: "Moneda del resumen" })).toBeVisible();
    expect(screen.getByRole("link", { name: "USD" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "ARS" })).toHaveAttribute("href", "/dashboard?currency=ARS");

    usePathnameMock.mockReturnValue("/expenses");
    rerender(
      <AppShell user={{ name: "Agustín", email: "agustin@example.com" }}>
        Contenido
      </AppShell>,
    );
    expect(screen.getByRole("group", { name: "Moneda del resumen" })).toBeVisible();

    usePathnameMock.mockReturnValue("/expenses/recurring");
    rerender(
      <AppShell user={{ name: "Agustín", email: "agustin@example.com" }}>
        Contenido
      </AppShell>,
    );
    expect(screen.queryByRole("group", { name: "Moneda del resumen" })).not.toBeInTheDocument();

    usePathnameMock.mockReturnValue("/clients");
    rerender(
      <AppShell user={{ name: "Agustín", email: "agustin@example.com" }}>
        Contenido
      </AppShell>,
    );
    expect(screen.queryByRole("group", { name: "Moneda del resumen" })).not.toBeInTheDocument();
  });

  it("uses the remembered currency and preserves expense filters when switching", async () => {
    const user = userEvent.setup();
    usePathnameMock.mockReturnValue("/expenses");
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams("q=nube&status=pending&page=3"),
    );
    useThemeMock.mockReturnValue({ theme: "system", setTheme: vi.fn() });

    render(
      <AppShell
        user={{ name: "Agustín", email: "agustin@example.com" }}
        initialCurrency="ARS"
      >
        Contenido
      </AppShell>,
    );

    expect(screen.getByRole("link", { name: "ARS" })).toHaveAttribute(
      "aria-current",
      "true",
    );
    const usd = screen.getByRole("link", { name: "USD" });
    expect(usd).toHaveAttribute(
      "href",
      "/expenses?q=nube&status=pending&currency=USD",
    );

    usd.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await user.click(usd);

    expect(document.cookie).toContain("kazeos_currency=USD");
  });

  it("orders the expense workspace in navigation without a reports dead link", () => {
    usePathnameMock.mockReturnValue("/expenses/recurring");
    useThemeMock.mockReturnValue({ theme: "system", setTheme: vi.fn() });
    render(
      <AppShell user={{ name: "Agustín", email: "agustin@example.com" }}>
        Contenido
      </AppShell>,
    );

    const navigation = screen.getByRole("navigation", { name: "Principal" });
    expect(within(navigation).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Dashboard",
      "Clientes",
      "Cobros",
      "Gastos",
      "Tareas",
      "Configuración",
    ]);
    const expensesLink = within(navigation).getByRole("link", { name: "Gastos", current: "page" });
    expect(expensesLink).toHaveAttribute("href", "/expenses");
    expect(expensesLink.querySelector(".lucide-receipt")).toBeInTheDocument();
    expect(within(navigation).queryByRole("link", { name: "Reportes" })).not.toBeInTheDocument();
  });

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

    const trigger = screen.getByRole("button", {
      name: "Abrir menú principal",
    });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "Menú principal" })).toBeVisible();
    const dialog = screen.getByRole("dialog", { name: "Menú principal" });
    expect(
      within(dialog).getByRole("button", { name: "Cerrar menú principal" }),
    ).toHaveFocus();
    expect(document.querySelector(".workspace")).toHaveAttribute("inert");

    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("dialog", { name: "Menú principal" }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.querySelector(".workspace")).not.toHaveAttribute("inert");
  });

  it("traps Tab in the mobile drawer and restores the trigger after navigation", async () => {
    const user = userEvent.setup();
    useThemeMock.mockReturnValue({ theme: "system", setTheme: vi.fn() });
    render(
      <AppShell user={{ name: "Agustín", email: "agustin@example.com" }}>
        <button type="button">Acción de fondo</button>
      </AppShell>,
    );

    const trigger = screen.getByRole("button", {
      name: "Abrir menú principal",
    });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Menú principal" });
    const close = within(dialog).getByRole("button", { name: "Cerrar menú principal" });
    const settings = within(dialog).getByRole("link", { name: "Configuración" });
    const brand = within(dialog).getByRole("link", { name: "KazeOS — Dashboard" });

    expect(close).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(brand).toHaveFocus();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(settings).toHaveFocus();
    await user.tab();
    expect(brand).toHaveFocus();
    expect(screen.getByRole("button", { name: "Acción de fondo" })).not.toHaveFocus();

    const clientsLink = within(dialog).getByRole("link", { name: "Clientes" });
    clientsLink.addEventListener("click", (event) => event.preventDefault(), {
      once: true,
    });
    await user.click(clientsLink);
    expect(dialog).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes and unlocks the drawer when resize or orientation crosses desktop", async () => {
    const user = userEvent.setup();
    const media = controllableMediaQuery(false);
    vi.stubGlobal("matchMedia", vi.fn(() => media.query));
    useThemeMock.mockReturnValue({ theme: "system", setTheme: vi.fn() });
    render(
      <AppShell user={{ name: "Agustín", email: "agustin@example.com" }}>
        <button type="button">Acción de fondo</button>
      </AppShell>,
    );

    const trigger = screen.getByRole("button", {
      name: "Abrir menú principal",
    });
    await user.click(trigger);
    expect(window.matchMedia).toHaveBeenCalledWith("(min-width: 980px)");
    expect(screen.getByRole("dialog", { name: "Menú principal" })).toBeVisible();
    expect(document.querySelector(".workspace")).toHaveAttribute("inert");

    act(() => media.setMatches(true));

    expect(
      screen.queryByRole("dialog", { name: "Menú principal" }),
    ).not.toBeInTheDocument();
    expect(document.querySelector(".workspace")).not.toHaveAttribute("inert");
    expect(document.body.style.overflow).toBe("");
    expect(
      screen.getByRole("link", { name: "Dashboard", current: "page" }),
    ).toHaveFocus();
    expect(trigger).not.toHaveFocus();
  });

  it("falls back to the first desktop navigation link when no route is active", async () => {
    const user = userEvent.setup();
    const media = controllableMediaQuery(false);
    vi.stubGlobal("matchMedia", vi.fn(() => media.query));
    usePathnameMock.mockReturnValue("/unlisted");
    useThemeMock.mockReturnValue({ theme: "system", setTheme: vi.fn() });
    render(
      <AppShell user={{ name: "Agustín", email: "agustin@example.com" }}>
        Contenido
      </AppShell>,
    );

    await user.click(
      screen.getByRole("button", { name: "Abrir menú principal" }),
    );
    act(() => media.setMatches(true));

    expect(
      within(screen.getByRole("navigation", { name: "Principal" })).getByRole(
        "link",
        { name: "Dashboard" },
      ),
    ).toHaveFocus();
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
    expect(screen.getByRole("menuitem", { name: "Nuevo cliente" })).toHaveFocus();
    expect(screen.getByRole("menuitem", { name: "Nuevo cobro" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Nuevo gasto" })).toHaveAttribute("href", "/expenses/new");
    expect(screen.getByRole("menuitem", { name: "Nueva tarea" })).toBeVisible();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Nuevo cobro" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitem", { name: "Nueva tarea" })).toHaveFocus();
    await user.keyboard("{Home}");
    expect(screen.getByRole("menuitem", { name: "Nuevo cliente" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Creación rápida" })).toHaveFocus();
    expect(screen.queryByRole("menu", { name: "Creación rápida" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tema" }));
    expect(screen.getByRole("menuitemradio", { name: "Claro" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "Oscuro" })).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitemradio", { name: "Claro" })).toHaveFocus();
    await user.keyboard("{End}");
    expect(screen.getByRole("menuitemradio", { name: "Sistema" })).toHaveFocus();
    await user.keyboard("{Home}");
    await user.click(screen.getByRole("menuitemradio", { name: "Oscuro" }));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });

  it("closes menus on Tab and gives keyboard focus to the next control", async () => {
    const user = userEvent.setup();
    useThemeMock.mockReturnValue({ theme: "system", setTheme: vi.fn() });
    render(
      <AppShell user={{ name: "Agustín", email: "agustin@example.com" }}>
        Contenido
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Creación rápida" }));
    await user.tab();

    expect(screen.queryByRole("menu", { name: "Creación rápida" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tema" })).toHaveFocus();
  });

  it("moves focus into the account menu and restores it on Escape", async () => {
    const user = userEvent.setup();
    useThemeMock.mockReturnValue({ theme: "system", setTheme: vi.fn() });
    render(
      <AppShell user={{ name: "Agustín", email: "agustin@example.com" }}>
        Contenido
      </AppShell>,
    );

    const account = screen.getByRole("button", { name: "Cuenta de Agustín" });
    await user.click(account);

    expect(screen.getByRole("menuitem", { name: "Cerrar sesión" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Cerrar sesión" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(account).toHaveFocus();
    expect(screen.queryByRole("menu", { name: "Cuenta" })).not.toBeInTheDocument();
  });

  it("opens menus from arrow keys at the expected edge item", async () => {
    const user = userEvent.setup();
    useThemeMock.mockReturnValue({ theme: "system", setTheme: vi.fn() });
    render(
      <AppShell user={{ name: "Agustín", email: "agustin@example.com" }}>
        Contenido
      </AppShell>,
    );

    const quick = screen.getByRole("button", { name: "Creación rápida" });
    quick.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Nuevo cliente" })).toHaveFocus();
    await user.keyboard("{Escape}");

    const theme = screen.getByRole("button", { name: "Tema" });
    theme.focus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("menuitemradio", { name: "Sistema" })).toHaveFocus();
  });
});
