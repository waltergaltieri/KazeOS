import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  withAuthenticatedDb: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));

import {
  getExpenseById,
  getExpenseFormOptions,
  getExpenses,
  getExpensesByCategory,
  getExpensesByScope,
  getExpenseSummary,
  getFixedVariableBreakdown,
  getRecurringExpenseById,
  getRecurringExpenses,
  getUpcomingExpenses,
} from "./expenses";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const expenseId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const recurringExpenseId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const period = { start: "2026-09-01", end: "2026-10-01" };

describe("expense query authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: ownerId });
    mocks.withAuthenticatedDb.mockResolvedValue([]);
  });

  it("binds every reusable read to the verified owner", async () => {
    await getExpenses({ period: "all" }, "2026-09-10");
    await getExpenseById(expenseId, "2026-09-10");
    await getExpenseFormOptions();
    await getExpenseSummary(period, "2026-09-10");
    await getUpcomingExpenses("2026-09-10", "USD", 8);
    await getExpensesByCategory(period);
    await getExpensesByScope(period);
    await getFixedVariableBreakdown(period);
    await getRecurringExpenses();
    await getRecurringExpenseById(recurringExpenseId);

    expect(mocks.withAuthenticatedDb).toHaveBeenCalledTimes(10);
    for (const [verifiedOwnerId, operation] of mocks.withAuthenticatedDb.mock.calls) {
      expect(verifiedOwnerId).toBe(ownerId);
      expect(operation).toEqual(expect.any(Function));
    }
  });

  it("rejects malformed identifiers, dates and pagination before opening a database scope", async () => {
    await expect(getExpenseById("bad", "2026-09-10")).rejects.toThrow();
    await expect(getRecurringExpenseById("bad")).rejects.toThrow();
    await expect(getExpenseSummary(
      { start: "2026-10-01", end: "2026-09-01" },
      "2026-09-10",
    )).rejects.toThrow();
    await expect(getExpenses(
      { period: "all", page: 0, pageSize: 101 },
      "2026-09-10",
    )).rejects.toThrow();

    expect(mocks.withAuthenticatedDb).not.toHaveBeenCalled();
  });
});
