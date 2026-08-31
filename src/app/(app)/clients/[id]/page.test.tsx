import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClientById: vi.fn(),
  getClientSummary: vi.fn(),
}));

vi.mock("@/components/clients/client-header", () => ({
  ClientHeader: () => null,
}));
vi.mock("@/components/clients/client-tabs", () => ({
  ClientTabs: () => null,
}));
vi.mock("@/lib/queries/clients", () => ({
  getClientById: mocks.getClientById,
  getClientSummary: mocks.getClientSummary,
}));

import ClientDetailPage from "./page";

describe("ClientDetailPage", () => {
  it("renders exact aggregate totals above MAX_SAFE_INTEGER", async () => {
    const exactTotal = (BigInt(Number.MAX_SAFE_INTEGER) * BigInt(2)).toString();
    mocks.getClientById.mockResolvedValue({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      firstName: "Total",
      lastName: "Exacto",
      company: null,
      email: null,
      phone: null,
      whatsapp: null,
      website: null,
      taxId: null,
      address: null,
      notes: null,
      status: "active",
      joinedAt: "2026-08-31",
    });
    mocks.getClientSummary.mockResolvedValue({
      outstanding: { USD: exactTotal, ARS: "0" },
      collected: { USD: exactTotal, ARS: "0" },
      mrr: { USD: exactTotal, ARS: "0" },
      activeServices: 0,
      pendingTasks: 0,
      notes: 0,
    });

    render(
      await ClientDetailPage({
        params: Promise.resolve({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        }),
      }),
    );

    expect(screen.getAllByText(/USD\s*180\.143\.985\.094\.819,82/u)).toHaveLength(3);
  });
});
