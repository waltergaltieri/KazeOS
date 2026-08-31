import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/payments", () => ({
  createPaymentAction: vi.fn(),
  correctPaymentAction: vi.fn(),
}));
import { PaymentHistory } from "./payment-history";
describe("PaymentHistory", () => { it("renders every payment as a chronological movement", () => { render(<PaymentHistory payments={[{ id: "1", amountMinor: 1000, currency: "USD", paymentDate: "2026-08-31", paymentMethod: "cash", reference: null, notes: null, createdAt: new Date() }, { id: "2", amountMinor: 2000, currency: "USD", paymentDate: "2026-08-30", paymentMethod: "bank_transfer", reference: "OP", notes: null, createdAt: new Date() }]} />); expect(screen.getAllByRole("listitem")).toHaveLength(2); expect(screen.getByText("OP")).toBeInTheDocument(); }); });

describe("payment correction", () => {
  it("opens the selected immutable payment in an accessible correction dialog", async () => {
    const user = userEvent.setup();
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute("open", "");
    };
    render(
      <PaymentHistory
        today="2026-08-31"
        charge={{
          id: "11111111-1111-4111-8111-111111111111",
          clientId: "22222222-2222-4222-8222-222222222222",
          clientName: "Estudio Norte",
          description: "Mantenimiento",
          amountMinor: 10_000,
          amountPaidMinor: 4_000,
          currency: "USD",
        }}
        payments={[{
          id: "33333333-3333-4333-8333-333333333333",
          amountMinor: 4_000,
          currency: "USD",
          paymentDate: "2026-08-30",
          paymentMethod: "cash",
          reference: "REC-1",
          notes: "Caja",
          createdAt: new Date(),
        }]}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Corregir pago de USD 40,00" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Corregir pago de Estudio Norte" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Monto")).toHaveValue("40,00");
    expect(screen.getByLabelText("Fecha")).toHaveValue("2026-08-30");
    expect(screen.getByLabelText("Referencia")).toHaveValue("REC-1");
    expect(document.querySelector('input[name="paymentId"]')).toHaveValue(
      "33333333-3333-4333-8333-333333333333",
    );
  });
});
