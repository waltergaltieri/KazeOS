import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPageData: vi.fn(), getCookie: vi.fn(), redirect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/queries/expense-page", () => ({ getExpensePageData: mocks.getPageData }));
vi.mock("@/lib/domain/commercial-date", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/domain/commercial-date")>(),
  todayInBusinessZone: () => "2026-09-03",
}));
vi.mock("@/lib/actions/expenses", () => ({ cancelExpenseAction: vi.fn(), correctPaidExpenseAction: vi.fn(), deleteExpenseAction: vi.fn(), markExpensePaidAction: vi.fn() }));
vi.mock("@/lib/actions/recurring-expenses", () => ({ cancelRecurringExpenseAction: vi.fn(), pauseRecurringExpenseAction: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.getCookie }),
}));

import ExpensesPage from "./page";

const summary = {
  USD: { actual: "0", pending: "0", overdue: "0", projected: "0", fixed: "0", variable: "0", monthlyFixedCommitments: "0" },
  ARS: { actual: "0", pending: "0", overdue: "0", projected: "0", fixed: "0", variable: "0", monthlyFixedCommitments: "0" },
};
const cashFlow = {
  USD: { projectedIncome: "0", actualIncome: "0", projectedExpenses: "0", actualExpenses: "0", projectedNet: "0", actualNet: "0" },
  ARS: { projectedIncome: "0", actualIncome: "0", projectedExpenses: "0", actualExpenses: "0", projectedNet: "0", actualNet: "0" },
};

function pageData(overrides: Record<string, unknown> = {}) {
  return {
    page: { items: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } },
    options: { categories: [], recurringExpenses: [] },
    recurringExpenses: [],
    insights: {
      status: "available",
      summary,
      cashFlow,
      byCategory: [],
      byScope: [],
      byCostType: [],
      upcomingExpenses: [],
    },
    ...overrides,
  };
}

describe("ExpensesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPageData.mockResolvedValue(pageData());
    mocks.getCookie.mockReturnValue(undefined);
  });

  it("normalizes a missing currency to USD for the ledger and projections", async () => {
    render(await ExpensesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.queryByRole("navigation", { name: "Moneda de lectura" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Resumen de gastos USD" })).toBeInTheDocument();
    expect(mocks.getPageData).toHaveBeenCalledWith({
      currency: "USD",
      expenseQuery: {
        categoryId: undefined,
        costType: undefined,
        currency: "USD",
        from: undefined,
        month: undefined,
        period: "current_month",
        recurrence: "all",
        scope: undefined,
        search: undefined,
        status: "all",
        to: undefined,
      },
      period: { start: "2026-09-01", end: "2026-10-01" },
      today: "2026-09-03",
    });
  });

  it("loads the selected URL-backed ledger period without a local currency selector", async () => {
    mocks.getPageData.mockResolvedValue(pageData({
      options: { categories: [{ id: "11111111-1111-4111-8111-111111111111", name: "Software", icon: null, active: true }], recurringExpenses: [] },
    }));

    render(await ExpensesPage({ searchParams: Promise.resolve({ q: "nube", status: "overdue", period: "next_month", month: "2026-10", categoryId: "11111111-1111-4111-8111-111111111111", scope: "business", costType: "fixed", recurrence: "recurring", currency: "USD" }) }));

    expect(screen.getByRole("heading", { name: "Gastos" })).toBeInTheDocument();
    expect(screen.getByText("0 gastos")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Compromisos recurrentes" })).toBeInTheDocument();
    expect(mocks.getPageData).toHaveBeenCalledWith(expect.objectContaining({
      currency: "USD",
      period: { start: "2026-11-01", end: "2026-12-01" },
      expenseQuery: expect.objectContaining({ search: "nube", status: "overdue", currency: "USD" }),
    }));
    expect(screen.queryByRole("navigation", { name: "Moneda de lectura" })).not.toBeInTheDocument();
  });

  it("uses the remembered currency unless a valid URL currency overrides it", async () => {
    mocks.getCookie.mockReturnValue({ value: "ARS" });

    const remembered = render(await ExpensesPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("region", { name: "Resumen de gastos ARS" })).toBeInTheDocument();
    expect(mocks.getPageData).toHaveBeenLastCalledWith(expect.objectContaining({
      currency: "ARS",
      expenseQuery: expect.objectContaining({ currency: "ARS" }),
    }));

    remembered.unmount();
    render(await ExpensesPage({ searchParams: Promise.resolve({ currency: "USD" }) }));
    expect(screen.getByRole("region", { name: "Resumen de gastos USD" })).toBeInTheDocument();
    expect(mocks.getPageData).toHaveBeenLastCalledWith(expect.objectContaining({
      currency: "USD",
      expenseQuery: expect.objectContaining({ currency: "USD" }),
    }));
  });

  it("ignores an invalid remembered currency", async () => {
    mocks.getCookie.mockReturnValue({ value: "EUR" });

    render(await ExpensesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("region", { name: "Resumen de gastos USD" })).toBeInTheDocument();
  });

  it("keeps every expense reachable through URL-preserving pagination", async () => {
    mocks.getPageData.mockResolvedValue(pageData({ page: { items: [], pagination: { page: 2, pageSize: 25, total: 70, totalPages: 3 } } }));

    render(await ExpensesPage({ searchParams: Promise.resolve({ q: "nube", status: "pending", page: "2" }) }));

    expect(mocks.getPageData).toHaveBeenCalledWith(expect.objectContaining({ expenseQuery: expect.objectContaining({ page: "2", search: "nube", status: "pending", currency: "USD" }) }));
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Página anterior" })).toHaveAttribute("href", "/expenses?q=nube&status=pending&page=1");
    expect(screen.getByRole("link", { name: "Página siguiente" })).toHaveAttribute("href", "/expenses?q=nube&status=pending&page=3");
  });

  it("recovers from malformed URL parameters into the safe USD defaults", async () => {
    render(await ExpensesPage({ searchParams: Promise.resolve<Record<string, string | string[] | undefined>>({
      q: ["nube", "duplicado"], status: ["overdue", "paid"], period: "custom", month: "2026-99", from: "no-es-fecha", to: "2026-09-31",
      categoryId: "11111111-1111-1111-1111-111111111111", scope: "global", costType: "semi-fixed", recurrence: "sometimes", currency: "EUR", page: "10001",
    }) }));

    expect(mocks.getPageData).toHaveBeenCalledWith(expect.objectContaining({
      currency: "USD",
      expenseQuery: expect.objectContaining({ currency: "USD", period: "current_month", recurrence: "all", status: "all" }),
      period: { start: "2026-09-01", end: "2026-10-01" },
    }));
  });

  it("redirects a valid page beyond the result set without looping", async () => {
    mocks.getPageData.mockResolvedValue(pageData({ page: { items: [], pagination: { page: 999, pageSize: 25, total: 70, totalPages: 3 } } }));
    await ExpensesPage({ searchParams: Promise.resolve({ q: "nube", status: "pending", currency: "USD", page: "999" }) });
    expect(mocks.redirect).toHaveBeenCalledWith("/expenses?q=nube&status=pending&currency=USD&page=3");

    mocks.redirect.mockClear();
    mocks.getPageData.mockResolvedValue(pageData({ page: { items: [], pagination: { page: 3, pageSize: 25, total: 70, totalPages: 3 } } }));
    await ExpensesPage({ searchParams: Promise.resolve({ q: "nube", status: "pending", currency: "USD", page: "3" }) });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("keeps the operational ledger visible when the analytics transaction fails", async () => {
    mocks.getPageData.mockResolvedValue(pageData({
      page: {
        items: [{
          id: "expense", title: "Servidor productivo", description: null, amountMinor: 10000, currency: "USD", scope: "business", costType: "fixed", dueDate: "2026-09-18", paidDate: null, status: "pending", persistedStatus: "pending", paymentMethod: null, vendor: null, notes: null, periodKey: null, generatedAutomatically: false,
          category: { id: "category", name: "Software", icon: null, active: true }, recurringExpense: null,
        }],
        pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
      },
      insights: { status: "unavailable" },
    }));

    render(await ExpensesPage({ searchParams: Promise.resolve({ currency: "USD" }) }));

    expect(screen.getAllByText("Servidor productivo")).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("El análisis no está disponible");
    expect(screen.getAllByText("No disponible")).toHaveLength(5);
    expect(screen.queryByText("Agenda despejada")).not.toBeInTheDocument();
    expect(screen.queryByText("Sin gastos proyectados en este período.")).not.toBeInTheDocument();
    expect(screen.queryByText(/USD\s+0,00/)).not.toBeInTheDocument();
    expect(screen.getByText("1 gasto")).toBeInTheDocument();
  });
});
