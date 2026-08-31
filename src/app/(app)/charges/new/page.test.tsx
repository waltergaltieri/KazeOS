import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getClients: vi.fn(), getPrimaryCurrency: vi.fn() }));
vi.mock("@/lib/queries/clients", () => ({ getClients: mocks.getClients }));
vi.mock("@/lib/queries/settings", () => ({ getPrimaryCurrency: mocks.getPrimaryCurrency }));
vi.mock("@/lib/actions/charges", () => ({ createChargeAction: vi.fn() }));
vi.mock("@/components/charges/charge-form", () => ({ ChargeForm: ({ defaultCurrency }: { defaultCurrency: string }) => <output aria-label="Moneda inicial">{defaultCurrency}</output> }));

import NewChargePage from "./page";

describe("NewChargePage", () => {
  it("passes the owner primary currency to global and client-scoped creation", async () => {
    mocks.getClients.mockResolvedValue([{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", firstName: "Norte", lastName: null, company: null }]);
    mocks.getPrimaryCurrency.mockResolvedValue("ARS");
    render(await NewChargePage({ searchParams: Promise.resolve({ clientId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }) }));
    expect(screen.getByLabelText("Moneda inicial")).toHaveTextContent("ARS");
  });
});
