import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/services", () => ({
  deactivateServiceAction: vi.fn().mockResolvedValue({ status: "idle" }),
}));

import { ServiceList } from "./service-list";

const clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("ServiceList", () => {
  it("shows a purposeful empty state", () => {
    render(<ServiceList clientId={clientId} services={[]} />);

    expect(
      screen.getByRole("heading", { name: "Todavía no hay acuerdos" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear servicio" })).toHaveAttribute(
      "href",
      `/clients/${clientId}/services/new`,
    );
  });

  it("makes amount, cadence, next due, automation and status explicit", () => {
    render(
      <ServiceList
        clientId={clientId}
        services={[
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            clientId,
            name: "Soporte mensual",
            description: null,
            amountMinor: 125_050,
            currency: "USD",
            billingType: "recurring",
            billingFrequency: "monthly",
            billingDay: 15,
            startDate: "2026-08-31",
            endDate: null,
            status: "active",
            automaticChargeGeneration: true,
            nextDueDate: "2026-09-15",
          },
        ]}
      />,
    );

    expect(screen.getAllByText(/USD\s*1\.250,50/u).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mensual · día 15").length).toBeGreaterThan(0);
    expect(screen.getAllByText("15 de sept de 2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Automático").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Activo").length).toBeGreaterThan(0);
  });

  it("requires an explicit confirmation before pausing", async () => {
    const user = userEvent.setup();
    render(
      <ServiceList
        clientId={clientId}
        services={[
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            clientId,
            name: "Soporte mensual",
            description: null,
            amountMinor: 10_000,
            currency: "ARS",
            billingType: "recurring",
            billingFrequency: "monthly",
            billingDay: 10,
            startDate: "2026-08-31",
            endDate: null,
            status: "active",
            automaticChargeGeneration: true,
            nextDueDate: "2026-09-10",
          },
        ]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Pausar Soporte mensual" }));
    expect(screen.getByText(/¿Pausar este acuerdo\?/)).toBeInTheDocument();
    expect(screen.getByText(/cargos ya proyectados se conservan/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar pausa" })).toHaveFocus();
  });
});
