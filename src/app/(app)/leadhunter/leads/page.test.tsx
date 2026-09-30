import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getLeadHunterLeads: vi.fn() }));
vi.mock("@/lib/queries/leadhunter", () => ({ getLeadHunterLeads: mocks.getLeadHunterLeads }));

import LeadHunterLeadsPage from "./page";

describe("LeadHunterLeadsPage", () => {
  it("lists prospects independently of their campaigns", async () => {
    mocks.getLeadHunterLeads.mockResolvedValue([
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        name: "Distribuidora Sur",
        countryCode: "AR",
        city: "Rosario",
        website: null,
        status: "researching",
        updatedAt: new Date(),
      },
    ]);

    render(await LeadHunterLeadsPage());

    expect(screen.getByRole("heading", { name: "Prospectos" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Distribuidora Sur" })).toHaveAttribute(
      "href",
      "/leadhunter/leads/cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    );
    expect(screen.getByText("Sin sitio informado")).toBeInTheDocument();
  });
});
