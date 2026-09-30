import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getLeadHunterLeadById: vi.fn() }));

vi.mock("@/lib/queries/leadhunter", () => ({
  getLeadHunterLeadById: mocks.getLeadHunterLeadById,
}));
vi.mock("next/navigation", () => ({ notFound: vi.fn() }));

import LeadHunterLeadPage from "./page";

describe("LeadHunterLeadPage", () => {
  it("separates observed evidence from commercial hypotheses", async () => {
    mocks.getLeadHunterLeadById.mockResolvedValue({
      lead: {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        name: "Distribuidora Sur",
        countryCode: "AR",
        city: "Rosario",
        website: null,
        description: "Pedidos mayoristas",
        status: "researching",
        linkedClientId: null,
      },
      contacts: [{ id: "d", firstName: "Ana", lastName: null, role: "Ventas", email: "ana@example.com", phone: null }],
      evidence: [
        { id: "e1", kind: "fact", field: "canal", value: "Publica pedidos por WhatsApp", sourceType: "manual", sourceUrl: null, confidence: 100, observedAt: new Date() },
        { id: "e2", kind: "hypothesis", field: "necesidad", value: "Podría ordenar el seguimiento comercial", sourceType: "manual", sourceUrl: null, confidence: 60, observedAt: new Date() },
      ],
      campaigns: [{ campaignId: "b", campaignName: "Mayoristas Argentina", evaluation: "pending", status: "researching", score: null }],
    });

    render(await LeadHunterLeadPage({ params: Promise.resolve({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }) }));

    expect(screen.getByRole("heading", { name: "Distribuidora Sur" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hechos observados" })).toBeInTheDocument();
    expect(screen.getByText("Publica pedidos por WhatsApp")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Hipótesis para conversar" })).toBeInTheDocument();
    expect(screen.getByText("Podría ordenar el seguimiento comercial")).toBeInTheDocument();
  });
});
