import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getExpenses: vi.fn(),
  getOptions: vi.fn(),
  getRecurring: vi.fn(),
  getSummary: vi.fn(),
  getCashFlow: vi.fn(),
  getByCategory: vi.fn(),
  getByScope: vi.fn(),
  getByCostType: vi.fn(),
  getUpcoming: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/queries/expenses", () => ({
  getExpenses: mocks.getExpenses,
  getExpenseFormOptions: mocks.getOptions,
  getRecurringExpenses: mocks.getRecurring,
  getExpenseSummary: mocks.getSummary,
  getExpensesByCategory: mocks.getByCategory,
  getExpensesByScope: mocks.getByScope,
  getFixedVariableBreakdown: mocks.getByCostType,
  getUpcomingExpenses: mocks.getUpcoming,
}));
vi.mock("@/lib/queries/cash-flow", () => ({ getMonthlyCashFlow: mocks.getCashFlow }));
vi.mock("@/lib/domain/commercial-date", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/domain/commercial-date")>(),
  todayInBusinessZone: () => "2026-09-03",
}));
vi.mock("@/lib/actions/expenses", () => ({ cancelExpenseAction: vi.fn(), correctPaidExpenseAction: vi.fn(), deleteExpenseAction: vi.fn(), markExpensePaidAction: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn() }) }));

import ExpensesPage from "./page";

describe("ExpensesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getExpenses.mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
    mocks.getOptions.mockResolvedValue({ categories: [], recurringExpenses: [] });
    mocks.getRecurring.mockResolvedValue([]);
    mocks.getSummary.mockResolvedValue({
      USD: { actual: "0", pending: "0", overdue: "0", projected: "0", fixed: "0", variable: "0", monthlyFixedCommitments: "0" },
      ARS: { actual: "0", pending: "0", overdue: "0", projected: "0", fixed: "0", variable: "0", monthlyFixedCommitments: "0" },
    });
    mocks.getCashFlow.mockResolvedValue({
      USD: { projectedIncome: "0", actualIncome: "0", projectedExpenses: "0", actualExpenses: "0", projectedNet: "0", actualNet: "0" },
      ARS: { projectedIncome: "0", actualIncome: "0", projectedExpenses: "0", actualExpenses: "0", projectedNet: "0", actualNet: "0" },
    });
    mocks.getByCategory.mockResolvedValue([]);
    mocks.getByScope.mockResolvedValue([]);
    mocks.getByCostType.mockResolvedValue([]);
    mocks.getUpcoming.mockResolvedValue([]);
  });

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
    expect(mocks.getSummary).toHaveBeenCalledWith({ start: "2026-11-01", end: "2026-12-01" }, "2026-09-03");
    expect(mocks.getCashFlow).toHaveBeenCalledWith("2026-11-01", "2026-12-01");
    expect(mocks.getByCategory).toHaveBeenCalledWith({ start: "2026-11-01", end: "2026-12-01" });
    expect(mocks.getUpcoming).toHaveBeenCalledWith("2026-09-03", 8);
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

  it("recovers from duplicate, malformed and out-of-range URL parameters", async () => {
    mocks.getExpenses.mockResolvedValue({ items: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } });
    mocks.getOptions.mockResolvedValue({ categories: [], recurringExpenses: [] });
    mocks.getRecurring.mockResolvedValue([]);

    render(await ExpensesPage({ searchParams: Promise.resolve<Record<string, string | string[] | undefined>>({
      q: ["nube", "duplicado"],
      status: ["overdue", "paid"],
      period: "custom",
      month: "2026-99",
      from: "no-es-fecha",
      to: "2026-09-31",
      categoryId: "11111111-1111-1111-1111-111111111111",
      scope: "global",
      costType: "semi-fixed",
      recurrence: "sometimes",
      currency: "EUR",
      page: "10001",
    }) }));

    expect(screen.getByRole("heading", { name: "Gastos" })).toBeInTheDocument();
    expect(mocks.getExpenses).toHaveBeenCalledWith({
      search: undefined,
      status: "all",
      period: "current_month",
      month: undefined,
      from: undefined,
      to: undefined,
      categoryId: undefined,
      scope: undefined,
      costType: undefined,
      recurrence: "all",
      currency: undefined,
    }, "2026-09-03");
  });

  it("redirects a valid page beyond the result set to the last page without looping", async () => {
    mocks.getExpenses.mockResolvedValue({ items: [], pagination: { page: 999, pageSize: 25, total: 70, totalPages: 3 } });
    mocks.getOptions.mockResolvedValue({ categories: [], recurringExpenses: [] });
    mocks.getRecurring.mockResolvedValue([]);

    await ExpensesPage({ searchParams: Promise.resolve({ q: "nube", status: "pending", currency: "USD", page: "999" }) });

    expect(mocks.redirect).toHaveBeenCalledOnce();
    expect(mocks.redirect).toHaveBeenCalledWith("/expenses?q=nube&status=pending&currency=USD&page=3");

    mocks.redirect.mockClear();
    mocks.getExpenses.mockResolvedValue({ items: [], pagination: { page: 3, pageSize: 25, total: 70, totalPages: 3 } });
    await ExpensesPage({ searchParams: Promise.resolve({ q: "nube", status: "pending", currency: "USD", page: "3" }) });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("starts every page projection in parallel", async () => {
    const resolvers: Array<() => void> = [];
    const pending = () => new Promise<void>((resolve) => resolvers.push(resolve));
    for (const query of [
      mocks.getExpenses,
      mocks.getOptions,
      mocks.getRecurring,
      mocks.getSummary,
      mocks.getCashFlow,
      mocks.getByCategory,
      mocks.getByScope,
      mocks.getByCostType,
      mocks.getUpcoming,
    ]) query.mockImplementationOnce(pending);

    const rendering = ExpensesPage({ searchParams: Promise.resolve({ currency: "ARS" }) });
    await Promise.resolve();
    await Promise.resolve();

    expect(resolvers).toHaveLength(9);
    expect(mocks.getSummary).toHaveBeenCalledWith({ start: "2026-09-01", end: "2026-10-01" }, "2026-09-03");
    expect(mocks.getCashFlow).toHaveBeenCalledWith("2026-09-01", "2026-10-01");

    // The suspended render proves no projection waits for a previous one.
    void rendering;
  });
});
