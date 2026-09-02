import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ClientList } from "./client-list";

describe("ClientList", () => {
  it("shows an honest empty state", () => {
    render(<ClientList clients={[]} />);
    expect(
      screen.getByRole("heading", { name: "Todavía no hay clientes" }),
    ).toBeInTheDocument();
    const createLink = screen.getByRole("link", { name: "Crear primer cliente" });
    expect(createLink).toHaveAttribute("href", "/clients/new");
    expect(createLink.getAttribute("class")).toBe("primary-button");
  });

  it("shows contextual no-results guidance when search or filters are active", () => {
    render(<ClientList clients={[]} hasActiveFilters />);

    expect(
      screen.getByRole("heading", { name: "No encontramos clientes" }),
    ).toBeInTheDocument();
    const clearLink = screen.getByRole("link", {
      name: "Limpiar búsqueda y filtros",
    });
    expect(clearLink).toHaveAttribute("href", "/clients");
    expect(clearLink.getAttribute("class")).toBe("secondary-button");
    expect(
      screen.queryByRole("heading", { name: "Todavía no hay clientes" }),
    ).not.toBeInTheDocument();
  });

  it("renders a client dossier with separated currency balances", () => {
    render(
      <ClientList
        clients={[
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            firstName: "Agustín",
            lastName: "Pérez",
            company: "Estudio Norte",
            email: "agustin@example.com",
            phone: null,
            status: "active",
            joinedAt: "2026-08-31",
            outstanding: { USD: "12500", ARS: "85000000" },
          },
        ]}
      />,
    );

    const businessLinks = screen.getAllByRole("link", {
      name: "Estudio Norte",
    });
    expect(businessLinks).toHaveLength(2);
    expect(businessLinks[0]).toHaveAttribute(
      "href",
      "/clients/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    expect(screen.getAllByText("Agustín Pérez")).toHaveLength(2);
    expect(screen.getAllByText(/USD\s*125,00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ARS\s*850\.000,00/).length).toBeGreaterThan(0);
  });

  it("renders an aggregate balance above MAX_SAFE_INTEGER without losing minor units", () => {
    const twoMaximumRows = (BigInt(Number.MAX_SAFE_INTEGER) * BigInt(2)).toString() as `${bigint}`;

    render(
      <ClientList
        clients={[
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            firstName: "Total",
            lastName: "Exacto",
            company: null,
            email: null,
            phone: null,
            status: "active",
            joinedAt: "2026-08-31",
            outstanding: { USD: twoMaximumRows, ARS: "0" },
          },
        ]}
      />,
    );

    expect(screen.getAllByRole("link", { name: "Total Exacto" })).toHaveLength(2);
    expect(screen.getAllByText("Cliente particular")).toHaveLength(2);
    expect(screen.getAllByText(/USD\s*180\.143\.985\.094\.819,82/u)).toHaveLength(2);
  });
});
