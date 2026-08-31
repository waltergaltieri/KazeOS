import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getClients: vi.fn() }));

vi.mock("@/lib/queries/clients", () => ({ getClients: mocks.getClients }));

import ClientsPage from "./page";

describe("ClientsPage", () => {
  it("distinguishes filtered zero results from a globally empty portfolio", async () => {
    mocks.getClients.mockResolvedValue([]);

    render(
      await ClientsPage({
        searchParams: Promise.resolve({ q: " Inexistente ", filter: "paused" }),
      }),
    );

    expect(mocks.getClients).toHaveBeenCalledWith({
      search: " Inexistente ",
      filter: "paused",
    });
    expect(
      screen.getByRole("heading", { name: "No encontramos clientes" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Limpiar búsqueda y filtros" }),
    ).toHaveAttribute("href", "/clients");
    expect(
      screen.queryByRole("heading", { name: "Todavía no hay clientes" }),
    ).not.toBeInTheDocument();
  });
});
