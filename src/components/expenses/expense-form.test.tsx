import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

import { ExpenseForm, type ExpenseFormDefaults } from "./expense-form";

const activeCategory = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Servicios",
  icon: null,
  active: true,
};
const inactiveCategory = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Archivo",
  icon: null,
  active: false,
};

const defaults: ExpenseFormDefaults = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  title: "Internet",
  description: "Fibra del estudio",
  amountMinor: 45_000_00,
  currency: "ARS",
  categoryId: inactiveCategory.id,
  scope: "business",
  costType: "fixed",
  dueDate: "2026-09-15",
  paidDate: null,
  status: "pending",
  paymentMethod: null,
  vendor: "Proveedor SA",
  notes: "Revisar aumento",
};

describe("ExpenseForm", () => {
  beforeEach(() => router.replace.mockReset());

  it("keeps the seven required obligation fields primary and defaults to pending", () => {
    render(
      <ExpenseForm
        oneOffAction={vi.fn()}
        categories={[activeCategory]}
        defaultCurrency="ARS"
      />,
    );

    const primary = screen.getByRole("group", { name: "Datos de la obligación" });
    expect(within(primary).getByLabelText("Título *")).toBeRequired();
    expect(within(primary).getByLabelText("Monto *")).toBeRequired();
    expect(within(primary).getByRole("combobox", { name: "Moneda" })).toHaveAttribute("aria-required", "true");
    expect(within(primary).getByRole("combobox", { name: "Categoría" })).toHaveAttribute("aria-required", "true");
    expect(within(primary).getByRole("combobox", { name: "Ámbito" })).toHaveAttribute("aria-required", "true");
    expect(within(primary).getByRole("combobox", { name: "Tipo de costo" })).toHaveAttribute("aria-required", "true");
    expect(within(primary).getByRole("button", { name: "Vencimiento: sin fecha" })).toHaveAttribute("aria-required", "true");
    expect(document.querySelector('input[name="status"]')).toHaveValue("pending");
    expect(screen.getByText("Información adicional")).toBeVisible();
  });

  it("reveals recurrence and paid details only when selected", async () => {
    const user = userEvent.setup();
    render(
      <ExpenseForm
        oneOffAction={vi.fn()}
        recurringAction={vi.fn()}
        categories={[activeCategory]}
      />,
    );

    expect(screen.queryByRole("group", { name: "Regla de recurrencia" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fecha de pago *")).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Repetir este gasto" }));
    expect(screen.getByRole("group", { name: "Regla de recurrencia" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Frecuencia" })).toBeVisible();
    expect(screen.getByLabelText("Día de vencimiento *")).toHaveValue(1);

    await user.click(screen.getByText("Información adicional"));
    await user.click(screen.getByRole("combobox", { name: "Estado" }));
    await user.click(screen.getByRole("option", { name: "Pagado" }));
    expect(screen.getByLabelText("Fecha de pago *")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Método de pago" })).toBeVisible();
  });

  it("excludes inactive categories on create but retains the historical selection on edit", () => {
    const { unmount } = render(
      <ExpenseForm
        oneOffAction={vi.fn()}
        categories={[activeCategory, inactiveCategory]}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Categoría" })).toHaveTextContent("Servicios");
    expect(document.querySelector('input[name="categoryId"]')).toHaveValue(activeCategory.id);

    unmount();
    render(
      <ExpenseForm
        oneOffAction={vi.fn()}
        categories={[activeCategory, inactiveCategory]}
        mode="edit"
        defaults={defaults}
      />,
    );

    expect(screen.getByRole("combobox", { name: "Categoría" })).toHaveTextContent("Archivo · inactiva");
    expect(document.querySelector('input[name="categoryId"]')).toHaveValue(inactiveCategory.id);
  });

  it("redirects both one-off and recurring successes to the expense ledger", async () => {
    const user = userEvent.setup();
    const oneOffAction = vi.fn().mockResolvedValue({ status: "success", expenseId: defaults.id });
    const recurringAction = vi.fn().mockResolvedValue({
      status: "success",
      recurringExpenseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });
    const { rerender } = render(
      <ExpenseForm oneOffAction={oneOffAction} recurringAction={recurringAction} categories={[activeCategory]} />,
    );

    await user.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/expenses"));

    router.replace.mockReset();
    rerender(
      <ExpenseForm
        oneOffAction={oneOffAction}
        recurringAction={recurringAction}
        categories={[activeCategory]}
        forceRecurring
      />,
    );
    await user.click(screen.getByRole("button", { name: "Guardar recurrencia" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/expenses"));
  });
});
