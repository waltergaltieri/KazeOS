import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import { CampaignForm } from "./campaign-form";

const action = vi.fn(async () => ({ status: "idle" as const }));

describe("CampaignForm", () => {
  it("shows the available public source channels", () => {
    render(<CampaignForm action={action} />);

    expect(screen.getByRole("checkbox", { name: /búsqueda web/i })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /linkedin/i })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: /instagram/i })).toBeEnabled();
  });

  it("lets the owner configure more follow-up steps", async () => {
    const user = userEvent.setup();
    render(<CampaignForm action={action} />);

    expect(screen.getByRole("heading", { name: "Contacto inicial" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Seguimiento 1" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /agregar seguimiento/i }));

    expect(screen.getByRole("heading", { name: "Seguimiento 2" })).toBeInTheDocument();
    expect(screen.getAllByDisplayValue("3")).toHaveLength(2);
  });
});
