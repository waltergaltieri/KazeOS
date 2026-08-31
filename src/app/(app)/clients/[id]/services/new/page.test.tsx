import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getClientById: vi.fn(), getPrimaryCurrency: vi.fn() }));
vi.mock("@/lib/queries/clients", () => ({ getClientById: mocks.getClientById }));
vi.mock("@/lib/queries/settings", () => ({ getPrimaryCurrency: mocks.getPrimaryCurrency }));
vi.mock("@/lib/actions/services", () => ({ createServiceAction: vi.fn() }));
vi.mock("@/components/services/service-form", () => ({ ServiceForm: ({ defaultCurrency }: { defaultCurrency: string }) => <output aria-label="Moneda inicial">{defaultCurrency}</output> }));

import NewServicePage from "./page";

describe("NewServicePage", () => {
  it("passes the owner primary currency to service creation", async () => {
    mocks.getClientById.mockResolvedValue({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    mocks.getPrimaryCurrency.mockResolvedValue("ARS");
    render(await NewServicePage({ params: Promise.resolve({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }) }));
    expect(screen.getByLabelText("Moneda inicial")).toHaveTextContent("ARS");
  });
});
