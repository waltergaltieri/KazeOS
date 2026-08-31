import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/payments", () => ({
  createPaymentAction: vi.fn(),
  correctPaymentAction: vi.fn(),
}));

import type { ChargeListItem } from "@/lib/queries/charges";
import { ChargeTable } from "./charge-table";

const base: ChargeListItem = {
  id: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  clientName: "Estudio Norte",
  serviceId: null,
  serviceName: null,
  description: "Anticipo manual",
  amountMinor: 10_000,
  amountPaidMinor: 0,
  currency: "USD",
  dueDate: "2026-09-15",
  status: "pending",
  persistedStatus: "pending",
  generatedAutomatically: false,
};

describe("ChargeTable operations", () => {
  it("preserves the client scope in the empty-state create action", () => {
    render(<ChargeTable today="2026-08-31" charges={[]} createHref="/charges/new?clientId=22222222-2222-4222-8222-222222222222" />);
    expect(screen.getByRole("link", { name: "Nuevo cobro" })).toHaveAttribute("href", "/charges/new?clientId=22222222-2222-4222-8222-222222222222");
  });
  it("exposes edit only for eligible manual zero-paid pending charges", () => {
    render(
      <ChargeTable
        today="2026-08-31"
        charges={[
          base,
          { ...base, id: "55555555-5555-4555-8555-555555555555", description: "Manual vencido", dueDate: "2026-08-15", status: "overdue" },
          { ...base, id: "33333333-3333-4333-8333-333333333333", description: "Automático", generatedAutomatically: true },
          { ...base, id: "44444444-4444-4444-8444-444444444444", description: "Parcial", amountPaidMinor: 100, status: "partial" },
        ]}
      />,
    );

    expect(screen.getAllByRole("link", { name: "Editar cobro Anticipo manual" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Editar cobro Manual vencido" })).toHaveLength(2);
    expect(screen.queryByRole("link", { name: "Editar cobro Automático" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Editar cobro Parcial" })).not.toBeInTheDocument();
  });
});
