import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ClientList } from "./client-list";

describe("ClientList", () => {
  it("shows an honest empty state", () => {
    render(<ClientList clients={[]} />);
    expect(
      screen.getByRole("heading", { name: "Todavía no hay clientes" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear primer cliente" })).toHaveAttribute(
      "href",
      "/clients/new",
    );
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
            outstanding: { USD: 12_500, ARS: 850_000_00 },
          },
        ]}
      />,
    );

    expect(screen.getAllByRole("link", { name: /Agustín Pérez/ })[0]).toHaveAttribute(
      "href",
      "/clients/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
    expect(screen.getAllByText(/USD\s*125,00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ARS\s*850\.000,00/).length).toBeGreaterThan(0);
  });
});
