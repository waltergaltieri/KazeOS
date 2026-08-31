import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChargeFilters } from "./charge-filters";

describe("ChargeFilters", () => {
  it("preserves every incoming scope across search, tabs and advanced filtering", () => {
    const { container } = render(
      <ChargeFilters
        params={{
          q: "hosting",
          status: "overdue",
          clientId: "11111111-1111-4111-8111-111111111111",
          serviceId: "22222222-2222-4222-8222-222222222222",
          currency: "USD",
          from: "2026-08-01",
          to: "2026-08-31",
        }}
        clients={[{ id: "11111111-1111-4111-8111-111111111111", label: "Estudio Norte" }]}
        services={[{ id: "22222222-2222-4222-8222-222222222222", label: "Hosting · Estudio Norte" }]}
      />,
    );

    const upcoming = new URL(
      screen.getByRole("link", { name: "Próximos" }).getAttribute("href")!,
      "http://localhost",
    );
    expect(Object.fromEntries(upcoming.searchParams)).toEqual({
      q: "hosting",
      status: "upcoming",
      clientId: "11111111-1111-4111-8111-111111111111",
      serviceId: "22222222-2222-4222-8222-222222222222",
      currency: "USD",
      from: "2026-08-01",
      to: "2026-08-31",
    });

    const search = screen.getByRole("search");
    expect(search.querySelector('input[name="clientId"]')).toHaveValue(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(search.querySelector('input[name="serviceId"]')).toHaveValue(
      "22222222-2222-4222-8222-222222222222",
    );
    const advanced = container.querySelector(".charge-advanced form")!;
    expect(advanced.querySelector('input[name="q"]')).toHaveValue("hosting");
    expect(advanced.querySelector('input[name="status"]')).toHaveValue("overdue");
    expect(advanced.querySelector('input[name="clientId"]')).toHaveValue(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(advanced.querySelector('input[name="serviceId"]')).toHaveValue(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(screen.getByRole("link", { name: "Limpiar filtros" })).toHaveAttribute(
      "href",
      "/charges",
    );
  });
});
