import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));
vi.mock("@/lib/actions/charges", async () => ({
  cancelChargeAction: vi.fn(),
}));

import { ChargeForm } from "./charge-form";

describe("ChargeForm", () => {
  it("uses the owner's primary currency for a new charge", () => {
    render(
      <ChargeForm
        action={vi.fn()}
        clients={[{ id: "client-1", displayName: "Estudio Norte" }]}
        defaultCurrency="ARS"
      />,
    );

    expect(document.querySelector('input[name="currency"]')).toHaveValue("ARS");
  });

  it("formats the visible amount while keeping a clean submitted value", async () => {
    const user = userEvent.setup();
    render(
      <ChargeForm
        action={vi.fn()}
        clients={[{ id: "client-1", displayName: "Estudio Norte" }]}
        defaultCurrency="ARS"
      />,
    );

    const amount = screen.getByLabelText("Monto *");
    await user.type(amount, "50000");

    expect(amount).toHaveValue("50.000");
    expect(amount.closest(".money-control")).toHaveAttribute("data-prefix", "$");
    expect(document.querySelector('input[type="hidden"][name="amount"]')).toHaveValue("50000");

    await user.click(screen.getByRole("combobox", { name: "Moneda" }));
    await user.click(screen.getByRole("option", { name: "USD" }));
    expect(amount.closest(".money-control")).toHaveAttribute("data-prefix", "US$");
  });

  it("selects the due date from a mini calendar and submits ISO format", async () => {
    const user = userEvent.setup();
    render(
      <ChargeForm
        action={vi.fn()}
        mode="edit"
        clients={[{ id: "client-1", displayName: "Estudio Norte" }]}
        selectedClientId="client-1"
        chargeId="11111111-1111-4111-8111-111111111111"
        defaults={{
          description: "Mantenimiento",
          amountMinor: 12_345,
          currency: "ARS",
          dueDate: "2026-09-15",
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Vencimiento: 15/09/2026" }));
    expect(screen.getByRole("dialog", { name: "Seleccionar vencimiento" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Mes siguiente" }));
    expect(screen.getByText("octubre 2026")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "20/10/2026" }));

    expect(screen.getByRole("button", { name: "Vencimiento: 20/10/2026" })).toBeVisible();
    expect(document.querySelector('input[type="hidden"][name="dueDate"]')).toHaveValue("2026-10-20");
  });

  it("renders an immutable-client edit form with persisted defaults and cancellation", () => {
    render(
      <ChargeForm
        action={vi.fn()}
        mode="edit"
        clients={[{ id: "client-1", displayName: "Estudio Norte" }]}
        selectedClientId="client-1"
        chargeId="11111111-1111-4111-8111-111111111111"
        defaults={{
          description: "Mantenimiento",
          amountMinor: 12_345,
          currency: "ARS",
          dueDate: "2026-09-15",
        }}
        defaultCurrency="USD"
      />,
    );

    expect(screen.getByText("Estudio Norte")).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Cliente" })).not.toBeInTheDocument();
    expect(document.querySelector('input[name="clientId"]')).toHaveValue("client-1");
    expect(document.querySelector('input[name="chargeId"]')).toHaveValue(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(screen.getByLabelText("Concepto *")).toHaveValue("Mantenimiento");
    expect(screen.getByLabelText("Monto *")).toHaveValue("123,45");
    expect(screen.getByRole("button", { name: "Vencimiento: 15/09/2026" })).toBeVisible();
    expect(document.querySelector('input[type="hidden"][name="dueDate"]')).toHaveValue("2026-09-15");
    expect(document.querySelector('input[name="currency"]')).toHaveValue("ARS");
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancelar cobro" })).toBeVisible();
  });
});
