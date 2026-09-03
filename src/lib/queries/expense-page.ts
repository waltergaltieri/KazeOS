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
export interface ExpensePageDataInput {
  currency: Currency;
  expenseQuery: ExpenseQueryInput;
  period: ExpensePeriod;
  today: string;
}

export type ExpenseInsights = {
  status: "available";
  summary: ExpenseSummary;
  cashFlow: MonthlyCashFlow;
  byCategory: ExpenseCategoryBreakdown[];
  byScope: Array<ExpenseDimensionBreakdown<ExpenseScope>>;
  byCostType: Array<ExpenseDimensionBreakdown<ExpenseCostType>>;
  upcomingExpenses: ExpenseListItem[];
} | {
  status: "unavailable";
};

export interface ExpensePageData {
  page: ExpenseListPage;
  options: ExpenseFormOptions;
  recurringExpenses: RecurringExpenseListItem[];
  insights: ExpenseInsights;
}

export async function getExpensePageData(input: ExpensePageDataInput): Promise<ExpensePageData> {
  const user = await requireUser();
  const [page, options, recurringExpenses] = await withAuthenticatedDb(user.id, (database) =>
    Promise.all([
      queryExpenses(database, user.id, input.expenseQuery, input.today),
      queryExpenseFormOptions(database, user.id, { includeInactive: true }),
      queryRecurringExpenses(database, user.id),
    ]),
  );

  let insights: ExpenseInsights;
  try {
    insights = await withAuthenticatedDb(user.id, async (database) => {
      const [summary, cashFlow, byCategory, byScope, byCostType, upcomingExpenses] = await Promise.all([
        queryExpenseSummary(database, user.id, input.period, input.today),
        queryMonthlyCashFlow(database, user.id, input.period.start, input.period.end),
        queryExpensesByCategory(database, user.id, input.period),
        queryExpensesByScope(database, user.id, input.period),
        queryFixedVariableBreakdown(database, user.id, input.period),
        queryUpcomingExpenses(database, user.id, input.today, input.currency, 8),
      ]);
      return { status: "available", summary, cashFlow, byCategory, byScope, byCostType, upcomingExpenses };
    });
  } catch {
    insights = { status: "unavailable" };
  }

  return { page, options, recurringExpenses, insights };
}
