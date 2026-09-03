import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  toggle: vi.fn(),
}));

vi.mock("@/lib/actions/expense-categories", () => ({
  createExpenseCategoryAction: mocks.create,
  updateExpenseCategoryAction: mocks.update,
  toggleExpenseCategoryAction: mocks.toggle,
}));

import { ExpenseCategoryManager } from "./expense-category-manager";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function tokensFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)]
      .map((match) => [match[1], match[2]]),
  );
}

function luminance(hex: string | undefined) {
  if (!hex) return Number.NaN;
  const channels = [1, 3, 5]
    .map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string | undefined, background: string | undefined) {
  const values = [luminance(foreground), luminance(background)];
  if (values.some(Number.isNaN)) return 0;
  const [lighter, darker] = values.sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

const categories = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Servicios",
    icon: "Zap",
    active: true,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Viajes",
    icon: null,
    active: false,
  },
];

describe("ExpenseCategoryManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ status: "idle" });
    mocks.update.mockResolvedValue({ status: "idle" });
    mocks.toggle.mockResolvedValue({ status: "idle" });
  });

  it("shows active and inactive categories with their optional icons and no delete control", () => {
    render(<ExpenseCategoryManager categories={categories} />);

    const manager = screen.getByRole("region", { name: "Categorías de gastos" });
    expect(within(manager).getByText("Servicios")).toBeVisible();
    expect(within(manager).getByText("Zap")).toBeVisible();
    expect(within(manager).getByText("Activa")).toBeVisible();
    expect(within(manager).getByText("Viajes")).toBeVisible();
    expect(within(manager).getByText("Sin icono")).toBeVisible();
    expect(within(manager).getByText("Inactiva")).toBeVisible();
    expect(within(manager).queryByRole("button", { name: /eliminar/i })).not.toBeInTheDocument();
  });

  it("creates a category and treats its icon as optional", async () => {
    mocks.create.mockResolvedValueOnce({ status: "success", categoryId: categories[0].id });
    const user = userEvent.setup();
    render(<ExpenseCategoryManager categories={[]} />);

    await user.type(screen.getByLabelText("Nombre de la nueva categoría"), "  Impuestos  ");
    await user.click(screen.getByRole("button", { name: "Crear categoría" }));

    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    const submitted = mocks.create.mock.calls[0][1] as FormData;
    expect(submitted.get("name")).toBe("  Impuestos  ");
    expect(submitted.get("icon")).toBe("");
    expect(await screen.findByRole("status")).toHaveTextContent("Categoría creada.");
  });

  it("associates create field errors with the name control", async () => {
    mocks.create.mockResolvedValueOnce({
      status: "error",
      message: "Ya existe una categoría con ese nombre.",
      fieldErrors: { name: ["Usá un nombre diferente."] },
    });
    const user = userEvent.setup();
    render(<ExpenseCategoryManager categories={categories} />);

    const input = screen.getByLabelText("Nombre de la nueva categoría");
    await user.type(input, "Servicios");
    await user.click(screen.getByRole("button", { name: "Crear categoría" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ya existe una categoría");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Usá un nombre diferente.");
  });

  it("renames a category and updates its icon inline", async () => {
    mocks.update.mockResolvedValueOnce({ status: "success", categoryId: categories[0].id });
    const user = userEvent.setup();
    render(<ExpenseCategoryManager categories={categories} />);

    await user.click(screen.getByRole("button", { name: "Editar Servicios" }));
    const editor = screen.getByRole("group", { name: "Editar Servicios" });
    const name = within(editor).getByLabelText("Nombre");
    const icon = within(editor).getByLabelText("Icono opcional");
    await user.clear(name);
    await user.type(name, "Servicios públicos");
    await user.clear(icon);
    await user.type(icon, "Bolt");
    await user.click(within(editor).getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    const submitted = mocks.update.mock.calls[0][1] as FormData;
    expect(submitted.get("categoryId")).toBe(categories[0].id);
    expect(submitted.get("name")).toBe("Servicios públicos");
    expect(submitted.get("icon")).toBe("Bolt");
    expect(await within(editor).findByRole("status")).toHaveTextContent("Categoría actualizada.");
  });

  it("requires an accessible confirmation before deactivating and restores focus on cancel", async () => {
    const user = userEvent.setup();
    render(<ExpenseCategoryManager categories={categories} />);

    const opener = screen.getByRole("button", { name: "Desactivar Servicios" });
    await user.click(opener);

    const confirmation = screen.getByRole("group", { name: "Desactivar Servicios" });
    expect(confirmation).toHaveAccessibleDescription(/seguirá visible en gastos históricos/i);
    expect(within(confirmation).getByRole("button", { name: "Confirmar desactivación" })).toHaveFocus();
    await user.click(within(confirmation).getByRole("button", { name: "Volver" }));
    expect(screen.getByRole("button", { name: "Desactivar Servicios" })).toHaveFocus();
    expect(mocks.toggle).not.toHaveBeenCalled();
  });

  it("deactivates and reactivates with inline feedback", async () => {
    mocks.toggle
      .mockResolvedValueOnce({ status: "success", categoryId: categories[0].id, active: false })
      .mockResolvedValueOnce({ status: "success", categoryId: categories[1].id, active: true });
    const user = userEvent.setup();
    render(<ExpenseCategoryManager categories={categories} />);

    await user.click(screen.getByRole("button", { name: "Desactivar Servicios" }));
    await user.click(screen.getByRole("button", { name: "Confirmar desactivación" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Servicios desactivada.");
    await waitFor(() => expect(
      screen.getByRole("button", { name: "Desactivar Servicios" }),
    ).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Reactivar Viajes" }));
    await user.click(screen.getByRole("button", { name: "Confirmar reactivación" }));
    expect((await screen.findAllByRole("status")).at(-1)).toHaveTextContent("Viajes reactivada.");
    await waitFor(() => expect(
      screen.getByRole("button", { name: "Reactivar Viajes" }),
    ).toHaveFocus());
  });

  it("restores focus to the stable category action after successful deactivation and reordering", async () => {
    let resolveToggle: ((value: { status: "success"; categoryId: string; active: false }) => void) | undefined;
    mocks.toggle.mockImplementationOnce(() => new Promise((resolve) => { resolveToggle = resolve; }));
    const user = userEvent.setup();
    const { rerender } = render(<ExpenseCategoryManager categories={categories} />);

    await user.click(screen.getByRole("button", { name: "Desactivar Servicios" }));
    await user.click(screen.getByRole("button", { name: "Confirmar desactivación" }));
    rerender(<ExpenseCategoryManager categories={[
      categories[1],
      { ...categories[0], active: false },
    ]} />);
    resolveToggle?.({ status: "success", categoryId: categories[0].id, active: false });

    await screen.findByText("Servicios desactivada.");
    await waitFor(() => expect(
      screen.getByRole("button", { name: "Reactivar Servicios" }),
    ).toHaveFocus());
  });

  it("disables category actions while their mutation is pending", async () => {
    let resolveCreate: ((value: { status: "success" }) => void) | undefined;
    mocks.create.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve; }));
    const user = userEvent.setup();
    render(<ExpenseCategoryManager categories={categories} />);

    await user.type(screen.getByLabelText("Nombre de la nueva categoría"), "Comisiones");
    await user.click(screen.getByRole("button", { name: "Crear categoría" }));

    expect(screen.getByRole("button", { name: "Creando categoría" })).toBeDisabled();
    resolveCreate?.({ status: "success" });
    await screen.findByText("Categoría creada.");
  });

  it("keeps category success, active and inactive text at WCAG AA contrast in both themes", () => {
    const light = { ...tokensFor(":root"), ...tokensFor(".settings-page") };
    const dark = { ...tokensFor(".dark"), ...tokensFor(".dark .settings-page") };

    for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
      for (const [foreground, background] of [
        ["settings-success-text", "paper-sheet"],
        ["settings-success-text", "collection-green-soft"],
        ["settings-inactive-text", "paper-sheet"],
        ["settings-inactive-text", "paper-inset"],
      ] as const) {
        expect(
          contrast(theme[foreground], theme[background]),
          `${name}: ${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }

    expect(css).toMatch(/\.settings-page \.form-success\s*\{[^}]*color:\s*var\(--settings-success-text\)/);
    expect(css).toMatch(/\.expense-category-status--active\s*\{[^}]*color:\s*var\(--settings-success-text\)/);
    expect(css).toMatch(/\.expense-category-status--inactive\s*\{[^}]*color:\s*var\(--settings-inactive-text\)/);
  });

  it("gives mobile confirmations a full-width row and controls", () => {
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*\.expense-category-toggle\s*\{[^}]*grid-column:\s*1 \/ -1[^}]*width:\s*100%/,
    );
    expect(css).toMatch(
      /@media \(max-width: 720px\)[\s\S]*\.expense-category-confirm\s*\{[^}]*width:\s*100%/,
    );
  });
});
