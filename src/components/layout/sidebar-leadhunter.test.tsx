import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/leadhunter" }));

import { DesktopSidebar } from "./sidebar";

describe("LeadHunter navigation", () => {
  it("adds a primary navigation entry and marks it active", () => {
    render(<DesktopSidebar />);

    expect(screen.getByRole("link", { name: "LeadHunter" })).toHaveAttribute(
      "href",
      "/leadhunter",
    );
    expect(screen.getByRole("link", { name: "LeadHunter" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
