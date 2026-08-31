import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import { ServiceForm } from "./service-form";

describe("ServiceForm", () => {
  it("switches coherently between recurring and one-time billing", async () => {
    const user = userEvent.setup();
    render(
      <ServiceForm
        action={vi.fn().mockResolvedValue({ status: "idle" })}
        clientId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        defaults={{ startDate: "2026-08-31" }}
      />,
    );

    expect(screen.getByLabelText(/Día de cobro/)).toBeEnabled();
    expect(screen.getByLabelText("Generar cargos automáticamente")).toBeEnabled();

    await user.selectOptions(screen.getByLabelText("Modalidad"), "one_time");

    expect(screen.getByLabelText(/Día de cobro/)).toBeDisabled();
    expect(screen.getByLabelText("Generar cargos automáticamente")).toBeDisabled();
    expect(screen.getByLabelText("Frecuencia")).toBeDisabled();
  });

  it("explains and preserves a locked currency", () => {
    render(
      <ServiceForm
        action={vi.fn().mockResolvedValue({ status: "idle" })}
        clientId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        currencyLocked
        defaults={{
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          name: "Soporte",
          amountMinor: 10_000,
          currency: "USD",
          billingType: "recurring",
          billingFrequency: "monthly",
          billingDay: 15,
          startDate: "2026-08-31",
          status: "active",
          automaticChargeGeneration: true,
        }}
      />,
    );

    expect(screen.getByLabelText("Moneda")).toBeDisabled();
    expect(
      screen.getByText(/moneda queda protegida porque ya existen cargos/i),
    ).toBeInTheDocument();
  });

  it("offers lifecycle options only when they are safe", () => {
    const action = vi.fn().mockResolvedValue({ status: "idle" });
    const { rerender } = render(
      <ServiceForm action={action} clientId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" />,
    );
    expect(screen.queryByRole("option", { name: "Cancelado" })).not.toBeInTheDocument();

    rerender(
      <ServiceForm
        action={action}
        clientId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        defaults={{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "active" }}
      />,
    );
    expect(screen.getByRole("option", { name: "Cancelado" })).toBeInTheDocument();
    expect(screen.getByText(/pausar conserva los cargos ya proyectados/i)).toBeInTheDocument();
    expect(screen.getByText(/cancelar es definitivo/i)).toBeInTheDocument();
  });

  it("disables lifecycle changes for a cancelled service", () => {
    render(
      <ServiceForm
        action={vi.fn().mockResolvedValue({ status: "idle" })}
        clientId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        defaults={{ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "cancelled" }}
      />,
    );

    expect(screen.getByLabelText("Estado")).toBeDisabled();
    expect(screen.getByText(/servicio cancelado no se puede reactivar/i)).toBeInTheDocument();
    expect(document.querySelector('input[type="hidden"][name="status"]')).toHaveValue("cancelled");
  });
});
