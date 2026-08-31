import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPaymentAction: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/actions/payments", () => ({
  createPaymentAction: mocks.createPaymentAction,
}));

import { PaymentDialog } from "./payment-dialog";

const charge = {
  id: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  clientName: "Estudio Norte",
  description: "Mantenimiento mensual",
  amountMinor: 10_000,
  amountPaidMinor: 4_000,
  currency: "USD" as const,
};

function Harness() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Registrar pago de mantenimiento
      </button>
      {open ? (
        <PaymentDialog
          charge={charge}
          today="2026-08-31"
          open
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

describe("PaymentDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPaymentAction.mockResolvedValue({ status: "idle" });
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  });

  it("names and describes the modal and restores its exact opener", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const opener = screen.getByRole("button", {
      name: "Registrar pago de mantenimiento",
    });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", {
      name: "Registrar pago de Estudio Norte",
    });
    expect(dialog).toHaveAccessibleDescription(
      "Mantenimiento mensual. Saldo pendiente USD 60,00.",
    );

    screen.getByLabelText("Monto").focus();
    await user.click(screen.getByRole("button", { name: "Cerrar registro de pago" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("clears stale overpay confirmation when the corrected amount no longer exceeds the balance", async () => {
    const user = userEvent.setup();
    mocks.createPaymentAction.mockResolvedValue({
      status: "confirm_overpay",
      message: "Confirmá el excedente.",
      overpayMinor: 1_000,
    });
    render(<Harness />);

    await user.click(
      screen.getByRole("button", { name: "Registrar pago de mantenimiento" }),
    );
    const amount = screen.getByLabelText("Monto");
    await user.clear(amount);
    await user.type(amount, "70,00");
    await user.click(screen.getByRole("button", { name: "Registrar pago" }));
    await waitFor(() =>
      expect(screen.getByText("Confirmar pago excedente")).toBeVisible(),
    );

    await user.clear(amount);
    await user.type(amount, "50,00");
    expect(screen.queryByText("Confirmar pago excedente")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Registrar pago" })).toBeEnabled();
  });
});
