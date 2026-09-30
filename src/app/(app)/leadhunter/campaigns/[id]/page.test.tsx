import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getLeadHunterCampaignWorkspace: vi.fn() }));

vi.mock("@/lib/queries/leadhunter", () => ({
  getLeadHunterCampaignWorkspace: mocks.getLeadHunterCampaignWorkspace,
}));
vi.mock("@/lib/actions/leadhunter", () => ({
  createLeadHunterLeadAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import LeadHunterCampaignPage from "./page";

describe("LeadHunterCampaignPage", () => {
  it("shows campaign configuration and its prospects", async () => {
    mocks.getLeadHunterCampaignWorkspace.mockResolvedValue({
      campaign: {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Mayoristas Argentina",
        objective: "Encontrar negocios con pedidos manuales.",
        serviceFocus: "custom_management",
        status: "draft",
        automationMode: "drafts",
        countries: ["AR"],
        sources: ["web_search", "directories"],
        positiveCriteria: ["Catálogo mayorista"],
        negativeCriteria: ["Ya es cliente"],
        schedule: {
          searchDays: ["monday"],
          searchTime: "09:00",
          sendDays: ["tuesday"],
          sendStart: "10:00",
          sendEnd: "16:00",
          timezone: "America/Argentina/Buenos_Aires",
        },
        sequenceSteps: [{ delayDays: 0, subjectInstruction: "Concreto", bodyInstruction: "Breve" }],
        dailyLeadLimit: 30,
        dailyEmailLimit: 12,
        configVersion: 1,
      },
      prospects: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          name: "Distribuidora Sur",
          countryCode: "AR",
          city: "Rosario",
          website: null,
          email: null,
          evaluation: "no_email",
          status: "researching",
          score: null,
          reason: null,
          nextActionAt: null,
        },
      ],
    });

    render(await LeadHunterCampaignPage({
      params: Promise.resolve({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
    }));

    expect(screen.getByRole("heading", { name: "Mayoristas Argentina" })).toBeInTheDocument();
    expect(screen.getByText("Distribuidora Sur")).toBeInTheDocument();
    expect(screen.getByText("Sin correo")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agregar prospecto" })).toBeInTheDocument();
    expect(screen.getByText(/web y directorios/i)).toBeInTheDocument();
  });
});
