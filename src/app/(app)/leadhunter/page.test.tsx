import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getLeadHunterCampaigns: vi.fn() }));

vi.mock("@/lib/queries/leadhunter", () => ({
  getLeadHunterCampaigns: mocks.getLeadHunterCampaigns,
}));

import LeadHunterPage from "./page";

describe("LeadHunterPage", () => {
  it("shows campaign progress and the next operational action", async () => {
    mocks.getLeadHunterCampaigns.mockResolvedValue([
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Mayoristas Argentina",
        objective: "Encontrar comercios con pedidos manuales.",
        serviceFocus: "custom_management",
        status: "active",
        automationMode: "drafts",
        countries: ["AR"],
        sources: ["web_search", "directories"],
        dailyLeadLimit: 30,
        dailyEmailLimit: 12,
        leadCount: 18,
        readyCount: 5,
        contactingCount: 4,
        repliedCount: 2,
        nextSearchAt: new Date("2026-09-30T12:00:00.000Z"),
        updatedAt: new Date("2026-09-29T15:00:00.000Z"),
      },
    ]);

    render(await LeadHunterPage());

    expect(screen.getByRole("heading", { name: "LeadHunter" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /nueva campaña/i })).toHaveAttribute(
      "href",
      "/leadhunter/campaigns/new",
    );
    expect(screen.getByText("Mayoristas Argentina")).toBeInTheDocument();
    expect(screen.getByText("18 prospectos")).toBeInTheDocument();
    expect(screen.getByText("2 respuestas")).toBeInTheDocument();
    expect(screen.getByText("Buscar")).toBeInTheDocument();
    expect(screen.getByText("Investigar")).toBeInTheDocument();
    expect(screen.getByText("Preparar")).toBeInTheDocument();
    expect(screen.getByText("Contactar")).toBeInTheDocument();
  });

  it("explains the first step when there are no campaigns", async () => {
    mocks.getLeadHunterCampaigns.mockResolvedValue([]);

    render(await LeadHunterPage());

    expect(screen.getByRole("heading", { name: "Creá tu primera búsqueda" })).toBeInTheDocument();
    expect(screen.getByText(/todavía no se enviará ningún correo/i)).toBeInTheDocument();
  });
});
