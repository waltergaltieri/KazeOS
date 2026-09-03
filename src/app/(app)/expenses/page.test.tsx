import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getExpenses: vi.fn(), getOptions: vi.fn(), getRecurring: vi.fn() }));
vi.mock("@/lib/queries/expenses", () => ({
  getExpenses: mocks.getExpenses,
  getExpenseFormOptions: mocks.getOptions,
  getRecurringExpenses: mocks.getRecurring,
}));
vi.mock("@/lib/domain/commercial-date", () => ({ todayInBusinessZone: () => "2026-09-03" }));
vi.mock("@/lib/actions/expenses", () => ({ cancelExpenseAction: vi.fn(), correctPaidExpenseAction: vi.fn(), deleteExpenseAction: vi.fn(), markExpensePaidAction: vi.fn() }));

import ExpensesPage from "./page";

describe("ExpensesPage", () => {
  it("loads the URL-backed ledger, options and recurring commitments", async () => {
    mocks.getExpenses.mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
    mocks.getOptions.mockResolvedValue({ categories: [{ id: "11111111-1111-4111-8111-111111111111", name: "Software", icon: null, active: true }], recurringExpenses: [] });
    mocks.getRecurring.mockResolvedValue([]);

    render(await ExpensesPage({ searchParams: Promise.resolve({ q: "nube", status: "overdue", period: "next_month", month: "2026-10", categoryId: "11111111-1111-4111-8111-111111111111", scope: "business", costType: "fixed", recurrence: "recurring", currency: "USD" }) }));

    expect(screen.getByRole("heading", { name: "Gastos" })).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Nuevo gasto" })[0]).toHaveAttribute("href", "/expenses/new");
    expect(mocks.getExpenses).toHaveBeenCalledWith({ search: "nube", status: "overdue", period: "next_month", month: "2026-10", categoryId: "11111111-1111-4111-8111-111111111111", scope: "business", costType: "fixed", recurrence: "recurring", currency: "USD", from: undefined, to: undefined }, "2026-09-03");
    expect(mocks.getOptions).toHaveBeenCalledWith({ includeInactive: true });
    expect(screen.getByText("0 gastos")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Compromisos recurrentes" })).toBeInTheDocument();
  });

  it("keeps every expense reachable through URL-preserving pagination", async () => {
    mocks.getExpenses.mockResolvedValue({ items: [], pagination: { page: 2, pageSize: 25, total: 70, totalPages: 3 } });
    mocks.getOptions.mockResolvedValue({ categories: [], recurringExpenses: [] });
    mocks.getRecurring.mockResolvedValue([]);

    render(await ExpensesPage({ searchParams: Promise.resolve({ q: "nube", status: "pending", page: "2" }) }));

    expect(mocks.getExpenses).toHaveBeenCalledWith(expect.objectContaining({ page: "2", search: "nube", status: "pending" }), "2026-09-03");
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Página anterior" })).toHaveAttribute("href", "/expenses?q=nube&status=pending&page=1");
    expect(screen.getByRole("link", { name: "Página siguiente" })).toHaveAttribute("href", "/expenses?q=nube&status=pending&page=3");
  });
});
