import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mark: vi.fn(), correct: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/actions/expenses", () => ({
  markExpensePaidAction: mocks.mark,
  correctPaidExpenseAction: mocks.correct,
}));

import { ExpensePaymentDialog, type PayableExpense } from "./expense-payment-dialog";

const expense: PayableExpense = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Servidor principal",
  amountMinor: 12_500,
  currency: "USD",
  paidDate: null,
  paymentMethod: null,
};

function Harness({ correction = false }: { correction?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Abrir pago</button>{open ? <ExpensePaymentDialog expense={correction ? { ...expense, paidDate: "2026-09-02", paymentMethod: "cash" } : expense} today="2026-09-10" correction={correction} open onClose={() => setOpen(false)} /> : null}</>;
}

describe("ExpensePaymentDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mark.mockResolvedValue({ status: "idle" });
    mocks.correct.mockResolvedValue({ status: "idle" });
    HTMLDialogElement.prototype.showModal = function showModal() { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function close() { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
  });

  it("defaults payment to the final amount and today in an accessible native dialog", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Abrir pago" });
    await user.click(opener);

    expect(screen.getByRole("dialog", { name: "Registrar pago de Servidor principal" })).toHaveAccessibleDescription("Importe final USD 125,00.");
    expect(screen.getByLabelText("Monto final")).toHaveValue("125,00");
    expect(screen.getByLabelText("Fecha de pago")).toHaveValue("2026-09-10");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("prefills a paid expense for controlled correction", async () => {
    const user = userEvent.setup();
    render(<Harness correction />);
    await user.click(screen.getByRole("button", { name: "Abrir pago" }));

    expect(screen.getByRole("dialog", { name: "Corregir pago de Servidor principal" })).toBeInTheDocument();
    expect(screen.getByLabelText("Fecha de pago")).toHaveValue("2026-09-02");
    expect(screen.getByRole("combobox", { name: "Método de pago" })).toHaveTextContent("Efectivo");
  });

  it("preserves card methods and presents paid-date errors inline", async () => {
    const user = userEvent.setup();
    mocks.correct.mockResolvedValue({ status: "error", message: "Revisá los campos indicados.", fieldErrors: { amount: ["Ingresá un monto válido."], paidDate: ["Ingresá una fecha válida."] } });
    render(<><ExpensePaymentDialog expense={{ ...expense, paidDate: "2026-09-02", paymentMethod: "credit_card" }} today="2026-09-10" correction open onClose={() => {}} /></>);

    expect(screen.getByRole("combobox", { name: "Método de pago" })).toHaveTextContent("Tarjeta de crédito");
    await user.click(screen.getByRole("button", { name: "Guardar corrección" }));

    expect(await screen.findByText("Ingresá un monto válido.")).toBeInTheDocument();
    expect(await screen.findByText("Ingresá una fecha válida.")).toBeInTheDocument();
    const amount = screen.getByLabelText("Monto final");
    const paidDate = screen.getByLabelText("Fecha de pago");
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(amount).toHaveAccessibleDescription("Ingresá un monto válido.");
    expect(paidDate).toHaveAttribute("aria-invalid", "true");
    expect(paidDate).toHaveAccessibleDescription("Ingresá una fecha válida.");
    expect(screen.getByText("Monto final").closest("label")).toHaveAttribute("for", amount.id);
    expect(screen.getByText("Fecha de pago").closest("label")).toHaveAttribute("for", paidDate.id);
  });
});
