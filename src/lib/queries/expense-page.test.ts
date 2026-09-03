import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  withAuthenticatedDb: vi.fn(),
  queryExpenses: vi.fn(),
  queryExpenseFormOptions: vi.fn(),
  queryRecurringExpenses: vi.fn(),
  queryExpenseSummary: vi.fn(),
  queryMonthlyCashFlow: vi.fn(),
  queryExpensesByCategory: vi.fn(),
  queryExpensesByScope: vi.fn(),
  queryFixedVariableBreakdown: vi.fn(),
  queryUpcomingExpenses: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));
vi.mock("./expenses", () => ({
  queryExpenses: mocks.queryExpenses,
  queryExpenseFormOptions: mocks.queryExpenseFormOptions,
  queryRecurringExpenses: mocks.queryRecurringExpenses,
  queryExpenseSummary: mocks.queryExpenseSummary,
  queryExpensesByCategory: mocks.queryExpensesByCategory,
  queryExpensesByScope: mocks.queryExpensesByScope,
  queryFixedVariableBreakdown: mocks.queryFixedVariableBreakdown,
  queryUpcomingExpenses: mocks.queryUpcomingExpenses,
}));
vi.mock("./cash-flow", () => ({ queryMonthlyCashFlow: mocks.queryMonthlyCashFlow }));

import { getExpensePageData } from "./expense-page";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const database = { name: "owner-db" };
const period = { start: "2026-09-01", end: "2026-10-01" };
const summary = {
  USD: { actual: "0", pending: "0", overdue: "0", projected: "0", fixed: "0", variable: "0", monthlyFixedCommitments: "0" },
  ARS: { actual: "0", pending: "0", overdue: "0", projected: "0", fixed: "0", variable: "0", monthlyFixedCommitments: "0" },
};
const cashFlow = {
  USD: { projectedIncome: "0", actualIncome: "0", projectedExpenses: "0", actualExpenses: "0", projectedNet: "0", actualNet: "0" },
  ARS: { projectedIncome: "0", actualIncome: "0", projectedExpenses: "0", actualExpenses: "0", projectedNet: "0", actualNet: "0" },
};
const page = { items: [], pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 } };
const options = { categories: [], recurringExpenses: [] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("getExpensePageData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: ownerId });
    mocks.withAuthenticatedDb.mockImplementation(async (_id, operation) => operation(database));
    mocks.queryExpenses.mockResolvedValue(page);
    mocks.queryExpenseFormOptions.mockResolvedValue(options);
    mocks.queryRecurringExpenses.mockResolvedValue([]);
    mocks.queryExpenseSummary.mockResolvedValue(summary);
    mocks.queryMonthlyCashFlow.mockResolvedValue(cashFlow);
    mocks.queryExpensesByCategory.mockResolvedValue([]);
    mocks.queryExpensesByScope.mockResolvedValue([]);
    mocks.queryFixedVariableBreakdown.mockResolvedValue([]);
    mocks.queryUpcomingExpenses.mockResolvedValue([]);
  });

  it("authenticates once and separates required ledger data from atomic analytics", async () => {
    const pageGate = deferred<typeof page>();
    const optionsGate = deferred<typeof options>();
    const recurringGate = deferred<[]>();
    const summaryGate = deferred<typeof summary>();
    const cashFlowGate = deferred<typeof cashFlow>();
    const categoryGate = deferred<[]>();
    const scopeGate = deferred<[]>();
    const typeGate = deferred<[]>();
    const upcomingGate = deferred<[]>();
    mocks.queryExpenses.mockReturnValueOnce(pageGate.promise);
    mocks.queryExpenseFormOptions.mockReturnValueOnce(optionsGate.promise);
    mocks.queryRecurringExpenses.mockReturnValueOnce(recurringGate.promise);
    mocks.queryExpenseSummary.mockReturnValueOnce(summaryGate.promise);
    mocks.queryMonthlyCashFlow.mockReturnValueOnce(cashFlowGate.promise);
    mocks.queryExpensesByCategory.mockReturnValueOnce(categoryGate.promise);
    mocks.queryExpensesByScope.mockReturnValueOnce(scopeGate.promise);
    mocks.queryFixedVariableBreakdown.mockReturnValueOnce(typeGate.promise);
    mocks.queryUpcomingExpenses.mockReturnValueOnce(upcomingGate.promise);

    const result = getExpensePageData({ currency: "USD", expenseQuery: { currency: "USD", period: "current_month" }, period, today: "2026-09-10" });
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledTimes(1);
    for (const query of [mocks.queryExpenses, mocks.queryExpenseFormOptions, mocks.queryRecurringExpenses]) {
      expect(query).toHaveBeenCalledOnce();
      expect(query.mock.calls[0][0]).toBe(database);
      expect(query.mock.calls[0][1]).toBe(ownerId);
    }

    pageGate.resolve(page);
    optionsGate.resolve(options);
    recurringGate.resolve([]);

    await vi.waitFor(() => expect(mocks.withAuthenticatedDb).toHaveBeenCalledTimes(2));
    for (const query of [mocks.queryExpenseSummary, mocks.queryMonthlyCashFlow, mocks.queryExpensesByCategory, mocks.queryExpensesByScope, mocks.queryFixedVariableBreakdown, mocks.queryUpcomingExpenses]) {
      expect(query).toHaveBeenCalledOnce();
      expect(query.mock.calls[0][0]).toBe(database);
      expect(query.mock.calls[0][1]).toBe(ownerId);
    }
    expect(mocks.queryUpcomingExpenses).toHaveBeenCalledWith(database, ownerId, "2026-09-10", "USD", 8);

    summaryGate.resolve(summary);
    cashFlowGate.resolve(cashFlow);
    categoryGate.resolve([]);
    scopeGate.resolve([]);
    typeGate.resolve([]);
    upcomingGate.resolve([]);
    await expect(result).resolves.toMatchObject({
      page,
      options,
      insights: { status: "available", summary, cashFlow },
    });
  });

  it("marks every insight unavailable when one query aborts the analytics transaction", async () => {
    mocks.queryExpensesByCategory.mockRejectedValue(new Error("category unavailable"));

    await expect(getExpensePageData({ currency: "ARS", expenseQuery: { currency: "ARS" }, period, today: "2026-09-10" })).resolves.toMatchObject({
      page,
      options,
      recurringExpenses: [],
      insights: { status: "unavailable" },
    });
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledTimes(2);
  });

  it("propagates a required ledger failure without starting analytics", async () => {
    mocks.queryExpenses.mockRejectedValue(new Error("ledger unavailable"));

    await expect(getExpensePageData({ currency: "USD", expenseQuery: { currency: "USD" }, period, today: "2026-09-10" }))
      .rejects.toThrow("ledger unavailable");

    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledOnce();
    expect(mocks.queryExpenseSummary).not.toHaveBeenCalled();
  });
});
