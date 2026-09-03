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
    expect(within(primary).getByRole("button", { name: "Vencimiento: sin fecha" })).toHaveAccessibleDescription("Campo obligatorio.");
    expect(document.querySelector('input[name="status"]')).toHaveValue("pending");
    expect(screen.getByText("Información adicional")).toBeVisible();
  });

  it("reveals recurrence and one-off paid details only when selected", async () => {
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

    await user.click(screen.getByText("Información adicional"));
    await user.click(screen.getByRole("combobox", { name: "Estado" }));
    await user.click(screen.getByRole("option", { name: "Pagado" }));
    expect(screen.getByRole("button", { name: "Fecha de pago: sin fecha" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Método de pago" })).toBeVisible();

    await user.click(screen.getByRole("checkbox", { name: "Repetir este gasto" }));
    expect(screen.getByRole("group", { name: "Regla de recurrencia" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Frecuencia" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Fecha de pago: sin fecha" })).not.toBeInTheDocument();
    expect(document.querySelector('input[name="status"]')).toHaveValue("pending");

    await user.click(screen.getByRole("combobox", { name: "Estado" }));
    expect(screen.queryByRole("option", { name: "Pagado" })).not.toBeInTheDocument();
  });

  it("preserves every entered value after an action error", async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockResolvedValue({
      status: "error",
      message: "No pudimos guardar el cambio.",
      fieldErrors: { title: ["Revisá el título."] },
    });
    render(
      <ExpenseForm
        oneOffAction={action}
        categories={[activeCategory]}
        defaults={{ dueDate: "2026-09-15" }}
      />,
    );

    await user.type(screen.getByLabelText("Título *"), "Seguro del auto");
    await user.type(screen.getByLabelText("Monto *"), "125000");
    await user.click(screen.getByRole("combobox", { name: "Ámbito" }));
    await user.click(screen.getByRole("option", { name: "Familia" }));
    await user.click(screen.getByText("Información adicional"));
    await user.type(screen.getByLabelText("Descripción"), "Cobertura anual");
    await user.type(screen.getByLabelText("Proveedor"), "Aseguradora Sur");
    await user.type(screen.getByLabelText("Notas"), "Póliza 42");
    await user.click(screen.getByRole("button", { name: "Guardar gasto" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos guardar el cambio.");
    expect(document.querySelector('input[name="title"]')).toHaveValue("Seguro del auto");
    expect(screen.getByLabelText("Monto *")).toHaveValue("125.000");
    expect(screen.getByRole("combobox", { name: "Ámbito" })).toHaveTextContent("Familia");
    expect(screen.getByRole("button", { name: "Vencimiento: 15/09/2026" })).toBeVisible();
    expect(screen.getByLabelText("Descripción")).toHaveValue("Cobertura anual");
    expect(screen.getByLabelText("Proveedor")).toHaveValue("Aseguradora Sur");
    expect(screen.getByLabelText("Notas")).toHaveValue("Póliza 42");
  });

  it("submits complete paid metadata for a one-off expense", async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockResolvedValue({ status: "error", message: "Control" });
    render(
      <ExpenseForm
        oneOffAction={action}
        categories={[activeCategory]}
        defaults={{ ...defaults, categoryId: activeCategory.id }}
      />,
    );

    await user.click(screen.getByText("Información adicional"));
    await user.click(screen.getByRole("combobox", { name: "Estado" }));
    await user.click(screen.getByRole("option", { name: "Pagado" }));
    await user.click(screen.getByRole("button", { name: "Fecha de pago: sin fecha" }));
    await user.click(screen.getByRole("button", { name: "18/09/2026" }));
    await user.click(screen.getByRole("combobox", { name: "Método de pago" }));
    await user.click(screen.getByRole("option", { name: "Tarjeta de crédito" }));
    await user.click(screen.getByRole("button", { name: "Guardar gasto" }));

    await screen.findByRole("alert");
    const formData = action.mock.calls[0]![1] as FormData;
    expect(Object.fromEntries(formData)).toMatchObject({
      status: "paid",
      paidDate: "2026-09-18",
      paymentMethod: "credit_card",
    });
    expect(screen.getByRole("button", { name: "Fecha de pago: 18/09/2026" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Método de pago" })).toHaveTextContent("Tarjeta de crédito");
  });

  it("maps the primary due date to recurrence metadata without a second start date", async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockResolvedValue({ status: "error", message: "Control" });
    render(
      <ExpenseForm
        recurringAction={action}
        categories={[activeCategory]}
        forceRecurring
        defaults={{
          ...defaults,
          categoryId: activeCategory.id,
          dueDate: "2026-09-15",
          frequency: "quarterly",
          billingDay: 31,
          endDate: "2027-09-15",
        }}
      />,
    );

    expect(screen.queryByLabelText("Inicio *")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fin: 15/09/2027" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Guardar recurrencia" }));

    await screen.findByRole("alert");
    const formData = action.mock.calls[0]![1] as FormData;
    expect(formData.get("dueDate")).toBe("2026-09-15");
    expect(formData.get("startDate")).toBeNull();
    expect(formData.get("billingDay")).toBe("15");
    expect(formData.get("endDate")).toBe("2027-09-15");
    expect(formData.get("status")).toBe("pending");
    expect(screen.getByRole("combobox", { name: "Frecuencia" })).toHaveTextContent("Trimestral");
    expect(screen.getByRole("button", { name: "Fin: 15/09/2027" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Generar vencimientos automáticamente" })).toBeChecked();
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
