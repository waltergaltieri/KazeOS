import "server-only";

import { withAuthenticatedDb } from "@/db";
import { requireUser } from "@/lib/auth/require-user";
import type { MonthlyCashFlow } from "@/lib/domain/cash-flow";
import type { Currency } from "@/lib/domain/money";
import { queryMonthlyCashFlow } from "./cash-flow";
import {
  queryExpenseFormOptions,
  queryExpenses,
  queryExpensesByCategory,
  queryExpensesByScope,
  queryExpenseSummary,
  queryFixedVariableBreakdown,
  queryRecurringExpenses,
  queryUpcomingExpenses,
  type ExpenseCategoryBreakdown,
  type ExpenseDimensionBreakdown,
  type ExpenseFormOptions,
  type ExpenseListItem,
  type ExpenseListPage,
  type ExpensePeriod,
  type ExpenseQueryInput,
  type ExpenseSummary,
  type RecurringExpenseListItem,
} from "./expenses";

type ExpenseScope = "personal" | "business" | "family" | "friends" | "partner" | "other";
type ExpenseCostType = "fixed" | "variable";
export type ExpenseInsightName = "summary" | "cash-flow" | "category" | "scope" | "cost-type" | "upcoming";

export interface ExpensePageDataInput {
  currency: Currency;
  expenseQuery: ExpenseQueryInput;
  period: ExpensePeriod;
  today: string;
}

export interface ExpensePageData {
  page: ExpenseListPage;
  options: ExpenseFormOptions;
  recurringExpenses: RecurringExpenseListItem[];
  summary: ExpenseSummary;
  cashFlow: MonthlyCashFlow;
  byCategory: ExpenseCategoryBreakdown[];
  byScope: Array<ExpenseDimensionBreakdown<ExpenseScope>>;
  byCostType: Array<ExpenseDimensionBreakdown<ExpenseCostType>>;
  upcomingExpenses: ExpenseListItem[];
  insightUnavailable: ExpenseInsightName[];
}

const zeroSummary: ExpenseSummary = {
  USD: { actual: "0", pending: "0", overdue: "0", projected: "0", fixed: "0", variable: "0", monthlyFixedCommitments: "0" },
  ARS: { actual: "0", pending: "0", overdue: "0", projected: "0", fixed: "0", variable: "0", monthlyFixedCommitments: "0" },
};
const zeroCashFlow: MonthlyCashFlow = {
  USD: { projectedIncome: "0", actualIncome: "0", projectedExpenses: "0", actualExpenses: "0", projectedNet: "0", actualNet: "0" },
  ARS: { projectedIncome: "0", actualIncome: "0", projectedExpenses: "0", actualExpenses: "0", projectedNet: "0", actualNet: "0" },
};

type OptionalResult<T> = { ok: true; value: T } | { ok: false };

function optional<T>(promise: Promise<T>): Promise<OptionalResult<T>> {
  return promise.then(
    (value) => ({ ok: true, value }),
    () => ({ ok: false }),
  );
}

function valueOrFallback<T>(
  result: OptionalResult<T>,
  fallback: T,
  name: ExpenseInsightName,
  unavailable: ExpenseInsightName[],
): T {
  if (result.ok) return result.value;
  unavailable.push(name);
  return fallback;
}

export async function getExpensePageData(input: ExpensePageDataInput): Promise<ExpensePageData> {
  const user = await requireUser();
  return withAuthenticatedDb(user.id, async (database) => {
    const [
      page,
      options,
      recurringExpenses,
      summaryResult,
      cashFlowResult,
      categoryResult,
      scopeResult,
      costTypeResult,
      upcomingResult,
    ] = await Promise.all([
      queryExpenses(database, user.id, input.expenseQuery, input.today),
      queryExpenseFormOptions(database, user.id, { includeInactive: true }),
      queryRecurringExpenses(database, user.id),
      optional(queryExpenseSummary(database, user.id, input.period, input.today)),
      optional(queryMonthlyCashFlow(database, user.id, input.period.start, input.period.end)),
      optional(queryExpensesByCategory(database, user.id, input.period)),
      optional(queryExpensesByScope(database, user.id, input.period)),
      optional(queryFixedVariableBreakdown(database, user.id, input.period)),
      optional(queryUpcomingExpenses(database, user.id, input.today, input.currency, 8)),
    ]);

    const insightUnavailable: ExpenseInsightName[] = [];
    return {
      page,
      options,
      recurringExpenses,
      summary: valueOrFallback(summaryResult, zeroSummary, "summary", insightUnavailable),
      cashFlow: valueOrFallback(cashFlowResult, zeroCashFlow, "cash-flow", insightUnavailable),
      byCategory: valueOrFallback(categoryResult, [], "category", insightUnavailable),
      byScope: valueOrFallback(scopeResult, [], "scope", insightUnavailable),
      byCostType: valueOrFallback(costTypeResult, [], "cost-type", insightUnavailable),
      upcomingExpenses: valueOrFallback(upcomingResult, [], "upcoming", insightUnavailable),
      insightUnavailable,
    };
  });
}
