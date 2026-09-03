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

    await user.click(screen.getByRole("button", { name: "Reactivar Viajes" }));
    await user.click(screen.getByRole("button", { name: "Confirmar reactivación" }));
    expect((await screen.findAllByRole("status")).at(-1)).toHaveTextContent("Viajes reactivada.");
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
});
