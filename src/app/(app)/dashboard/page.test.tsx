import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import DashboardPage from "./page";

describe("the authenticated dashboard entry", () => {
  it("renders a calm empty shell without fabricated business figures", () => {
    render(<DashboardPage />);

    expect(
      screen.getByRole("heading", { name: "Resumen diario" }),
    ).toBeVisible();
    expect(screen.getByText(/sin inventar información/i)).toBeVisible();
    expect(screen.queryByText(/USD\s+[\d.]+/)).not.toBeInTheDocument();
  });
});
