import "server-only";

import {
  and,
  asc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { withAuthenticatedDb } from "@/db";
import * as schema from "@/db/schema";
import {
  expenseCategories,
  expenses,
  recurringExpenses,
} from "@/db/schema";
import { requireUser } from "@/lib/auth/require-user";
import {
  addCommercialPeriod,
  validateCommercialDate,
} from "@/lib/domain/commercial-date";
import { zeroByCurrency, type MoneyByCurrency } from "@/lib/domain/currency-aggregate";
import type { AggregateMinorUnits, Currency } from "@/lib/domain/money";
import type { ExpenseStatus } from "@/lib/domain/expense-status";
import {
  expenseFiltersSchema,
  expenseIdSchema,
  recurringExpenseIdSchema,
  type ExpenseFilters,
} from "@/lib/validations/expense";

type ExpenseQueryDatabase = PostgresJsDatabase<typeof schema>;
type PersistedExpenseStatus = "planned" | "pending" | "paid" | "cancelled";
type ExpenseScope = "personal" | "business" | "family" | "friends" | "partner" | "other";
type ExpenseCostType = "fixed" | "variable";
type RecurringExpenseStatus = "active" | "paused" | "cancelled";
type RecurringExpenseFrequency = "monthly" | "quarterly" | "yearly";

export interface ExpensePeriod {
  start: string;
  end: string;
}

export interface ExpenseQueryInput {
  status?: ExpenseFilters["status"];
  period?: ExpenseFilters["period"];
  recurrence?: ExpenseFilters["recurrence"];
  categoryId?: string;
  currency?: Currency;
  scope?: ExpenseScope;
  costType?: ExpenseCostType;
  month?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number | string;
  pageSize?: number | string;
}

export interface ExpenseListItem {
  id: string;
  title: string;
  description: string | null;
  amountMinor: number;
  currency: Currency;
  scope: ExpenseScope;
  costType: ExpenseCostType;
  dueDate: string;
  paidDate: string | null;
  status: ExpenseStatus;
  persistedStatus: PersistedExpenseStatus;
  paymentMethod: typeof expenses.$inferSelect.paymentMethod;
  vendor: string | null;
  notes: string | null;
  periodKey: string | null;
  generatedAutomatically: boolean;
  category: {
    id: string;
    name: string;
    icon: string | null;
    active: boolean;
  };
  recurringExpense: {
    id: string;
    title: string;
    status: RecurringExpenseStatus;
    frequency: typeof recurringExpenses.$inferSelect.frequency;
  } | null;
}

export interface ExpenseListPage {
  items: ExpenseListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ExpenseSummaryAmounts {
  actual: AggregateMinorUnits;
  pending: AggregateMinorUnits;
  overdue: AggregateMinorUnits;
  projected: AggregateMinorUnits;
  fixed: AggregateMinorUnits;
  variable: AggregateMinorUnits;
  monthlyFixedCommitments: AggregateMinorUnits;
}

export type ExpenseSummary = Record<Currency, ExpenseSummaryAmounts>;

export interface ExpenseCategoryBreakdown {
  categoryId: string;
  label: string;
  icon: string | null;
  amounts: MoneyByCurrency;
}

export interface ExpenseDimensionBreakdown<TKey extends string> {
  key: TKey;
  amounts: MoneyByCurrency;
}

export interface ExpenseFormOptions {
  categories: Array<{
    id: string;
    name: string;
    icon: string | null;
    active: boolean;
  }>;
  recurringExpenses: Array<{
    id: string;
    title: string;
    currency: Currency;
    status: RecurringExpenseStatus;
  }>;
}

export interface RecurringExpenseListItem {
  id: string;
  title: string;
  description: string | null;
  amountMinor: number;
  currency: Currency;
  scope: ExpenseScope;
  costType: ExpenseCostType;
  frequency: RecurringExpenseFrequency | "one_time";
  billingDay: number;
  startDate: string;
  endDate: string | null;
  status: RecurringExpenseStatus;
  paymentMethod: typeof recurringExpenses.$inferSelect.paymentMethod;
  vendor: string | null;
  notes: string | null;
  automaticGeneration: boolean;
  category: {
    id: string;
    name: string;
    icon: string | null;
    active: boolean;
  };
}

interface ParsedExpenseQuery {
  filters: ExpenseFilters;
  page: number;
  pageSize: number;
}

interface RawExpensePageRow extends Record<string, unknown> {
  id: string | null;
  title: string | null;
  description: string | null;
  amount_minor: number | null;
  currency: Currency | null;
  scope: ExpenseScope | null;
  cost_type: ExpenseCostType | null;
  due_date: string | null;
  paid_date: string | null;
  display_status: ExpenseStatus | null;
  persisted_status: PersistedExpenseStatus | null;
  payment_method: typeof expenses.$inferSelect.paymentMethod;
  vendor: string | null;
  notes: string | null;
  period_key: string | null;
  generated_automatically: boolean | null;
  category_id: string | null;
  category_name: string | null;
  category_icon: string | null;
  category_active: boolean | null;
  recurring_expense_id: string | null;
  recurring_expense_title: string | null;
  recurring_expense_status: RecurringExpenseStatus | null;
  recurring_expense_frequency: typeof recurringExpenses.$inferSelect.frequency;
  total_count: number;
}

function parsePositiveInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  label: string,
): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = typeof value === "string" && /^\d+$/.test(value)
    ? Number(value)
    : value;
  if (
    typeof parsed !== "number" ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > maximum
  ) {
    throw new RangeError(`Invalid ${label}`);
  }
  return parsed;
}

function parseExpenseQuery(input: unknown): ParsedExpenseQuery {
  if (input === undefined) {
    return { filters: expenseFiltersSchema.parse({}), page: 1, pageSize: 25 };
  }
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    expenseFiltersSchema.parse(input);
    throw new RangeError("Invalid expense filters");
  }

  const { page, pageSize, ...filterInput } = input as Record<string, unknown>;
  return {
    filters: expenseFiltersSchema.parse(filterInput),
    page: parsePositiveInteger(page, 1, 10_000, "expense page"),
    pageSize: parsePositiveInteger(pageSize, 25, 100, "expense page size"),
  };
}

function validateExpensePeriod(input: ExpensePeriod): ExpensePeriod {
  if (typeof input !== "object" || input === null) {
    throw new RangeError("Invalid expense period");
  }
  const start = validateCommercialDate(input.start);
  const end = validateCommercialDate(input.end);
  if (start >= end) throw new RangeError("Expense period must be non-empty");
  return { start, end };
}

function monthStart(month: string): string {
  return `${month}-01`;
}

function filterPeriodConditions(filters: ExpenseFilters, today: string): SQL[] {
  if (filters.period === "all") return [];
  if (filters.period === "custom") {
    return [gte(expenses.dueDate, filters.from!), lte(expenses.dueDate, filters.to!)];
  }

  const selectedMonth = filters.month ?? today.slice(0, 7);
  const baseStart = monthStart(selectedMonth);
  const start = filters.period === "next_month"
    ? addCommercialPeriod(baseStart, "monthly")
    : baseStart;
  const end = addCommercialPeriod(start, "monthly");
  return [gte(expenses.dueDate, start), sql`${expenses.dueDate} < ${end}`];
}

const displayStatus = (today: string) => sql<ExpenseStatus>`case
  when ${expenses.status} = 'paid' then 'paid'
  when ${expenses.status} = 'cancelled' then 'cancelled'
  when ${expenses.dueDate} < ${today} then 'overdue'
  else ${expenses.status}::text
end`;

function escapedSearchPattern(search: string): string {
  return `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function filterConditions(filters: ExpenseFilters, today: string): SQL[] {
  const conditions = filterPeriodConditions(filters, today);
  if (filters.categoryId) conditions.push(eq(expenses.categoryId, filters.categoryId));
  if (filters.currency) conditions.push(eq(expenses.currency, filters.currency));
  if (filters.scope) conditions.push(eq(expenses.scope, filters.scope));
  if (filters.costType) conditions.push(eq(expenses.costType, filters.costType));
  if (filters.recurrence === "one_off") conditions.push(isNull(expenses.recurringExpenseId));
  if (filters.recurrence === "recurring") conditions.push(isNotNull(expenses.recurringExpenseId));
  if (filters.status !== "all") conditions.push(sql`${displayStatus(today)} = ${filters.status}`);
  if (filters.search) {
    const pattern = escapedSearchPattern(filters.search);
    conditions.push(or(
      ilike(expenses.title, pattern),
      ilike(expenses.vendor, pattern),
      ilike(expenses.description, pattern),
      ilike(expenses.notes, pattern),
    )!);
  }
  return conditions;
}

const expenseSelection = (today: string) => ({
  id: expenses.id,
  title: expenses.title,
  description: expenses.description,
  amountMinor: expenses.amountMinor,
  currency: expenses.currency,
  scope: expenses.scope,
  costType: expenses.costType,
  dueDate: expenses.dueDate,
  paidDate: expenses.paidDate,
  status: displayStatus(today),
  persistedStatus: expenses.status,
  paymentMethod: expenses.paymentMethod,
  vendor: expenses.vendor,
  notes: expenses.notes,
  periodKey: expenses.periodKey,
  generatedAutomatically: expenses.generatedAutomatically,
  category: {
    id: expenseCategories.id,
    name: expenseCategories.name,
    icon: expenseCategories.icon,
    active: expenseCategories.active,
  },
  recurringExpense: {
    id: recurringExpenses.id,
    title: recurringExpenses.title,
    status: recurringExpenses.status,
    frequency: recurringExpenses.frequency,
  },
});

export async function queryExpenses(
  database: ExpenseQueryDatabase,
  ownerId: string,
  input: unknown = {},
  asOfInput: string,
): Promise<ExpenseListPage> {
  const { filters, page, pageSize } = parseExpenseQuery(input);
  const today = validateCommercialDate(asOfInput);
  const offset = (page - 1) * pageSize;
  const rows = await database.execute<RawExpensePageRow>(sql`
    with filtered_expenses as (
      select
        ${expenses.id}::text as id,
        ${expenses.title} as title,
        ${expenses.description} as description,
        ${expenses.amountMinor}::float8 as amount_minor,
        ${expenses.currency}::text as currency,
        ${expenses.scope}::text as scope,
        ${expenses.costType}::text as cost_type,
        ${expenses.dueDate}::text as due_date,
        ${expenses.paidDate}::text as paid_date,
        ${displayStatus(today)} as display_status,
        ${expenses.status}::text as persisted_status,
        ${expenses.paymentMethod}::text as payment_method,
        ${expenses.vendor} as vendor,
        ${expenses.notes} as notes,
        ${expenses.periodKey} as period_key,
        ${expenses.generatedAutomatically} as generated_automatically,
        ${expenseCategories.id}::text as category_id,
        ${expenseCategories.name} as category_name,
        ${expenseCategories.icon} as category_icon,
        ${expenseCategories.active} as category_active,
        ${recurringExpenses.id}::text as recurring_expense_id,
        ${recurringExpenses.title} as recurring_expense_title,
        ${recurringExpenses.status}::text as recurring_expense_status,
        ${recurringExpenses.frequency}::text as recurring_expense_frequency
      from ${expenses}
      inner join ${expenseCategories}
        on ${expenseCategories.ownerId} = ${expenses.ownerId}
        and ${expenseCategories.id} = ${expenses.categoryId}
      left join ${recurringExpenses}
        on ${recurringExpenses.ownerId} = ${expenses.ownerId}
        and ${recurringExpenses.id} = ${expenses.recurringExpenseId}
      where ${and(
        eq(expenses.ownerId, ownerId),
        ...filterConditions(filters, today),
      )}
    ), expense_page as (
      select *
      from filtered_expenses
      order by case when display_status = 'overdue' then 0 else 1 end, due_date, id
      limit ${pageSize}
      offset ${offset}
    ), expense_total as (
      select count(*)::int as total_count
      from filtered_expenses
    )
    select expense_page.*, expense_total.total_count
    from expense_total
    left join expense_page on true
    order by case when expense_page.display_status = 'overdue' then 0 else 1 end,
      expense_page.due_date,
      expense_page.id
  `);

  const total = rows[0]?.total_count ?? 0;
  const items = rows.flatMap((row): ExpenseListItem[] => {
    if (
      row.id === null ||
      row.title === null ||
      row.amount_minor === null ||
      row.currency === null ||
      row.scope === null ||
      row.cost_type === null ||
      row.due_date === null ||
      row.display_status === null ||
      row.persisted_status === null ||
      row.generated_automatically === null ||
      row.category_id === null ||
      row.category_name === null ||
      row.category_active === null
    ) {
      return [];
    }
    return [{
      id: row.id,
      title: row.title,
      description: row.description,
      amountMinor: row.amount_minor,
      currency: row.currency,
      scope: row.scope,
      costType: row.cost_type,
      dueDate: row.due_date,
      paidDate: row.paid_date,
      status: row.display_status,
      persistedStatus: row.persisted_status,
      paymentMethod: row.payment_method,
      vendor: row.vendor,
      notes: row.notes,
      periodKey: row.period_key,
      generatedAutomatically: row.generated_automatically,
      category: {
        id: row.category_id,
        name: row.category_name,
        icon: row.category_icon,
        active: row.category_active,
      },
      recurringExpense: row.recurring_expense_id === null
        ? null
        : {
            id: row.recurring_expense_id,
            title: row.recurring_expense_title!,
            status: row.recurring_expense_status!,
            frequency: row.recurring_expense_frequency!,
          },
    }];
  });
  return {
    items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    },
  };
}

export async function queryExpenseById(
  database: ExpenseQueryDatabase,
  ownerId: string,
  idInput: unknown,
  asOfInput: string,
): Promise<ExpenseListItem | null> {
  const id = expenseIdSchema.parse(idInput);
  const today = validateCommercialDate(asOfInput);
  const [expense] = await database
    .select(expenseSelection(today))
    .from(expenses)
    .innerJoin(
      expenseCategories,
      and(
        eq(expenseCategories.ownerId, expenses.ownerId),
        eq(expenseCategories.id, expenses.categoryId),
      ),
    )
    .leftJoin(
      recurringExpenses,
      and(
        eq(recurringExpenses.ownerId, expenses.ownerId),
        eq(recurringExpenses.id, expenses.recurringExpenseId),
      ),
    )
    .where(and(eq(expenses.ownerId, ownerId), eq(expenses.id, id)))
    .limit(1);
  return expense ?? null;
}

export async function queryExpenseFormOptions(
  database: ExpenseQueryDatabase,
  ownerId: string,
  options: Readonly<{ includeInactive?: boolean }> = {},
): Promise<ExpenseFormOptions> {
  const categoryOwner = eq(expenseCategories.ownerId, ownerId);
  const [categories, templates] = await Promise.all([
    database
      .select({
        id: expenseCategories.id,
        name: expenseCategories.name,
        icon: expenseCategories.icon,
        active: expenseCategories.active,
      })
      .from(expenseCategories)
      .where(options.includeInactive
        ? categoryOwner
        : and(categoryOwner, eq(expenseCategories.active, true)))
      .orderBy(asc(sql`lower(${expenseCategories.name})`), asc(expenseCategories.id)),
    database
      .select({
        id: recurringExpenses.id,
        title: recurringExpenses.title,
        currency: recurringExpenses.currency,
        status: recurringExpenses.status,
      })
      .from(recurringExpenses)
      .where(and(
        eq(recurringExpenses.ownerId, ownerId),
        eq(recurringExpenses.status, "active"),
      ))
      .orderBy(asc(sql`lower(${recurringExpenses.title})`), asc(recurringExpenses.id)),
  ]);
  return { categories, recurringExpenses: templates };
}

interface ExpenseSummaryRow extends Record<string, unknown> {
  actual_usd: AggregateMinorUnits;
  actual_ars: AggregateMinorUnits;
  pending_usd: AggregateMinorUnits;
  pending_ars: AggregateMinorUnits;
  overdue_usd: AggregateMinorUnits;
  overdue_ars: AggregateMinorUnits;
  projected_usd: AggregateMinorUnits;
  projected_ars: AggregateMinorUnits;
  fixed_usd: AggregateMinorUnits;
  fixed_ars: AggregateMinorUnits;
  variable_usd: AggregateMinorUnits;
  variable_ars: AggregateMinorUnits;
  monthly_fixed_usd: AggregateMinorUnits;
  monthly_fixed_ars: AggregateMinorUnits;
}

export async function queryExpenseSummary(
  database: ExpenseQueryDatabase,
  ownerId: string,
  periodInput: ExpensePeriod,
  asOfInput: string,
): Promise<ExpenseSummary> {
  const { start, end } = validateExpensePeriod(periodInput);
  const today = validateCommercialDate(asOfInput);
  const rows = await database.execute<ExpenseSummaryRow>(sql`
    with expense_totals as (
      select
        coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = 'USD' and ${expenses.status} = 'paid' and ${expenses.paidDate} >= ${start} and ${expenses.paidDate} < ${end}), 0)::text as actual_usd,
        coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = 'ARS' and ${expenses.status} = 'paid' and ${expenses.paidDate} >= ${start} and ${expenses.paidDate} < ${end}), 0)::text as actual_ars,
        coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = 'USD' and ${expenses.status} = 'pending' and ${expenses.dueDate} >= ${start} and ${expenses.dueDate} < ${end}), 0)::text as pending_usd,
        coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = 'ARS' and ${expenses.status} = 'pending' and ${expenses.dueDate} >= ${start} and ${expenses.dueDate} < ${end}), 0)::text as pending_ars,
        coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = 'USD' and ${expenses.status} in ('planned', 'pending') and ${expenses.dueDate} >= ${start} and ${expenses.dueDate} < ${end} and ${expenses.dueDate} < ${today}), 0)::text as overdue_usd,
        coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = 'ARS' and ${expenses.status} in ('planned', 'pending') and ${expenses.dueDate} >= ${start} and ${expenses.dueDate} < ${end} and ${expenses.dueDate} < ${today}), 0)::text as overdue_ars,
        coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = 'USD' and ${expenses.status} <> 'cancelled' and ${expenses.dueDate} >= ${start} and ${expenses.dueDate} < ${end}), 0)::text as projected_usd,
        coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = 'ARS' and ${expenses.status} <> 'cancelled' and ${expenses.dueDate} >= ${start} and ${expenses.dueDate} < ${end}), 0)::text as projected_ars,
        coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = 'USD' and ${expenses.status} <> 'cancelled' and ${expenses.costType} = 'fixed' and ${expenses.dueDate} >= ${start} and ${expenses.dueDate} < ${end}), 0)::text as fixed_usd,
        coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = 'ARS' and ${expenses.status} <> 'cancelled' and ${expenses.costType} = 'fixed' and ${expenses.dueDate} >= ${start} and ${expenses.dueDate} < ${end}), 0)::text as fixed_ars,
        coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = 'USD' and ${expenses.status} <> 'cancelled' and ${expenses.costType} = 'variable' and ${expenses.dueDate} >= ${start} and ${expenses.dueDate} < ${end}), 0)::text as variable_usd,
        coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = 'ARS' and ${expenses.status} <> 'cancelled' and ${expenses.costType} = 'variable' and ${expenses.dueDate} >= ${start} and ${expenses.dueDate} < ${end}), 0)::text as variable_ars
      from ${expenses}
      where ${expenses.ownerId} = ${ownerId}
    ), recurring_totals as (
      select
        coalesce(floor((coalesce(sum(case ${recurringExpenses.frequency} when 'monthly' then ${recurringExpenses.amountMinor} * 12 when 'quarterly' then ${recurringExpenses.amountMinor} * 4 when 'yearly' then ${recurringExpenses.amountMinor} else 0 end) filter (where ${recurringExpenses.currency} = 'USD'), 0) + 6) / 12), 0)::text as monthly_fixed_usd,
        coalesce(floor((coalesce(sum(case ${recurringExpenses.frequency} when 'monthly' then ${recurringExpenses.amountMinor} * 12 when 'quarterly' then ${recurringExpenses.amountMinor} * 4 when 'yearly' then ${recurringExpenses.amountMinor} else 0 end) filter (where ${recurringExpenses.currency} = 'ARS'), 0) + 6) / 12), 0)::text as monthly_fixed_ars
      from ${recurringExpenses}
      where ${recurringExpenses.ownerId} = ${ownerId}
        and ${recurringExpenses.status} = 'active'
        and ${recurringExpenses.costType} = 'fixed'
        and ${recurringExpenses.startDate} < ${end}
        and (
          ${recurringExpenses.endDate} is null
          or ${recurringExpenses.endDate} >= ${start}
        )
    )
    select * from expense_totals cross join recurring_totals
  `);
  const row = rows[0];
  if (!row) throw new Error("Expense summary query returned no row");
  const amounts = (currency: "usd" | "ars"): ExpenseSummaryAmounts => ({
    actual: row[`actual_${currency}`],
    pending: row[`pending_${currency}`],
    overdue: row[`overdue_${currency}`],
    projected: row[`projected_${currency}`],
    fixed: row[`fixed_${currency}`],
    variable: row[`variable_${currency}`],
    monthlyFixedCommitments: row[`monthly_fixed_${currency}`],
  });
  return { USD: amounts("usd"), ARS: amounts("ars") };
}

interface AggregateDimensionRow<TKey extends string> {
  key: TKey;
  currency: Currency;
  amountMinor: AggregateMinorUnits;
}

function composeDimensionBreakdown<TKey extends string>(
  rows: readonly AggregateDimensionRow<TKey>[],
): Array<ExpenseDimensionBreakdown<TKey>> {
  const totals = new Map<TKey, MoneyByCurrency>();
  for (const row of rows) {
    const amounts = totals.get(row.key) ?? zeroByCurrency();
    amounts[row.currency] = row.amountMinor;
    totals.set(row.key, amounts);
  }
  return [...totals].map(([key, amounts]) => ({ key, amounts }));
}

function projectionConditions(ownerId: string, period: ExpensePeriod): SQL {
  return and(
    eq(expenses.ownerId, ownerId),
    ne(expenses.status, "cancelled"),
    gte(expenses.dueDate, period.start),
    sql`${expenses.dueDate} < ${period.end}`,
  )!;
}

export async function queryExpensesByCategory(
  database: ExpenseQueryDatabase,
  ownerId: string,
  periodInput: ExpensePeriod,
): Promise<ExpenseCategoryBreakdown[]> {
  const period = validateExpensePeriod(periodInput);
  const rows = await database
    .select({
      categoryId: expenseCategories.id,
      label: expenseCategories.name,
      icon: expenseCategories.icon,
      currency: expenses.currency,
      amountMinor: sql<AggregateMinorUnits>`sum(${expenses.amountMinor})::text`,
    })
    .from(expenses)
    .innerJoin(
      expenseCategories,
      and(
        eq(expenseCategories.ownerId, expenses.ownerId),
        eq(expenseCategories.id, expenses.categoryId),
      ),
    )
    .where(projectionConditions(ownerId, period))
    .groupBy(
      expenseCategories.id,
      expenseCategories.name,
      expenseCategories.icon,
      expenses.currency,
    )
    .orderBy(asc(sql`lower(${expenseCategories.name})`), asc(expenseCategories.id), asc(expenses.currency));

  const totals = new Map<string, ExpenseCategoryBreakdown>();
  for (const row of rows) {
    const item = totals.get(row.categoryId) ?? {
      categoryId: row.categoryId,
      label: row.label,
      icon: row.icon,
      amounts: zeroByCurrency(),
    };
    item.amounts[row.currency] = row.amountMinor;
    totals.set(row.categoryId, item);
  }
  return [...totals.values()];
}

export async function queryExpensesByScope(
  database: ExpenseQueryDatabase,
  ownerId: string,
  periodInput: ExpensePeriod,
): Promise<Array<ExpenseDimensionBreakdown<ExpenseScope>>> {
  const period = validateExpensePeriod(periodInput);
  const rows = await database
    .select({
      key: expenses.scope,
      currency: expenses.currency,
      amountMinor: sql<AggregateMinorUnits>`sum(${expenses.amountMinor})::text`,
    })
    .from(expenses)
    .where(projectionConditions(ownerId, period))
    .groupBy(expenses.scope, expenses.currency)
    .orderBy(asc(sql`${expenses.scope}::text`), asc(expenses.currency));
  return composeDimensionBreakdown(rows);
}

export async function queryFixedVariableBreakdown(
  database: ExpenseQueryDatabase,
  ownerId: string,
  periodInput: ExpensePeriod,
): Promise<Array<ExpenseDimensionBreakdown<ExpenseCostType>>> {
  const period = validateExpensePeriod(periodInput);
  const rows = await database
    .select({
      key: expenses.costType,
      currency: expenses.currency,
      amountMinor: sql<AggregateMinorUnits>`sum(${expenses.amountMinor})::text`,
    })
    .from(expenses)
    .where(projectionConditions(ownerId, period))
    .groupBy(expenses.costType, expenses.currency)
    .orderBy(asc(expenses.costType), asc(expenses.currency));
  return composeDimensionBreakdown(rows);
}

export async function queryUpcomingExpenses(
  database: ExpenseQueryDatabase,
  ownerId: string,
  asOfInput: string,
  limitInput = 5,
): Promise<ExpenseListItem[]> {
  const today = validateCommercialDate(asOfInput);
  const limit = parsePositiveInteger(limitInput, 5, 100, "upcoming expense limit");
  return database
    .select(expenseSelection(today))
    .from(expenses)
    .innerJoin(
      expenseCategories,
      and(
        eq(expenseCategories.ownerId, expenses.ownerId),
        eq(expenseCategories.id, expenses.categoryId),
      ),
    )
    .leftJoin(
      recurringExpenses,
      and(
        eq(recurringExpenses.ownerId, expenses.ownerId),
        eq(recurringExpenses.id, expenses.recurringExpenseId),
      ),
    )
    .where(and(
      eq(expenses.ownerId, ownerId),
      sql`${expenses.status} in ('planned', 'pending')`,
    ))
    .orderBy(
      sql`case when ${expenses.dueDate} < ${today} then 0 else 1 end`,
      asc(expenses.dueDate),
      asc(expenses.id),
    )
    .limit(limit);
}

const recurringExpenseSelection = {
  id: recurringExpenses.id,
  title: recurringExpenses.title,
  description: recurringExpenses.description,
  amountMinor: recurringExpenses.amountMinor,
  currency: recurringExpenses.currency,
  scope: recurringExpenses.scope,
  costType: recurringExpenses.costType,
  frequency: recurringExpenses.frequency,
  billingDay: recurringExpenses.billingDay,
  startDate: recurringExpenses.startDate,
  endDate: recurringExpenses.endDate,
  status: recurringExpenses.status,
  paymentMethod: recurringExpenses.paymentMethod,
  vendor: recurringExpenses.vendor,
  notes: recurringExpenses.notes,
  automaticGeneration: recurringExpenses.automaticGeneration,
  category: {
    id: expenseCategories.id,
    name: expenseCategories.name,
    icon: expenseCategories.icon,
    active: expenseCategories.active,
  },
};

export async function queryRecurringExpenses(
  database: ExpenseQueryDatabase,
  ownerId: string,
): Promise<RecurringExpenseListItem[]> {
  return database
    .select(recurringExpenseSelection)
    .from(recurringExpenses)
    .innerJoin(
      expenseCategories,
      and(
        eq(expenseCategories.ownerId, recurringExpenses.ownerId),
        eq(expenseCategories.id, recurringExpenses.categoryId),
      ),
    )
    .where(eq(recurringExpenses.ownerId, ownerId))
    .orderBy(
      sql`case ${recurringExpenses.status} when 'active' then 0 when 'paused' then 1 else 2 end`,
      asc(sql`lower(${recurringExpenses.title})`),
      asc(recurringExpenses.id),
    );
}

export async function queryRecurringExpenseById(
  database: ExpenseQueryDatabase,
  ownerId: string,
  idInput: unknown,
): Promise<RecurringExpenseListItem | null> {
  const id = recurringExpenseIdSchema.parse(idInput);
  const [recurringExpense] = await database
    .select(recurringExpenseSelection)
    .from(recurringExpenses)
    .innerJoin(
      expenseCategories,
      and(
        eq(expenseCategories.ownerId, recurringExpenses.ownerId),
        eq(expenseCategories.id, recurringExpenses.categoryId),
      ),
    )
    .where(and(
      eq(recurringExpenses.ownerId, ownerId),
      eq(recurringExpenses.id, id),
    ))
    .limit(1);
  return recurringExpense ?? null;
}

export async function getExpenses(
  input: unknown = {},
  asOfInput: string,
): Promise<ExpenseListPage> {
  parseExpenseQuery(input);
  validateCommercialDate(asOfInput);
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) =>
    queryExpenses(database, user.id, input, asOfInput));
}

export async function getExpenseById(idInput: unknown, asOfInput: string) {
  expenseIdSchema.parse(idInput);
  validateCommercialDate(asOfInput);
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) =>
    queryExpenseById(database, user.id, idInput, asOfInput));
}

export async function getExpenseFormOptions(
  options: Readonly<{ includeInactive?: boolean }> = {},
) {
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) =>
    queryExpenseFormOptions(database, user.id, options));
}

export async function getExpenseSummary(
  periodInput: ExpensePeriod,
  asOfInput: string,
) {
  validateExpensePeriod(periodInput);
  validateCommercialDate(asOfInput);
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) =>
    queryExpenseSummary(database, user.id, periodInput, asOfInput));
}

export async function getUpcomingExpenses(asOfInput: string, limit = 5) {
  validateCommercialDate(asOfInput);
  parsePositiveInteger(limit, 5, 100, "upcoming expense limit");
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) =>
    queryUpcomingExpenses(database, user.id, asOfInput, limit));
}

async function authenticatedPeriodQuery<TResult>(
  periodInput: ExpensePeriod,
  query: (
    database: ExpenseQueryDatabase,
    ownerId: string,
    period: ExpensePeriod,
  ) => Promise<TResult>,
): Promise<TResult> {
  const period = validateExpensePeriod(periodInput);
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) => query(database, user.id, period));
}

export const getExpensesByCategory = (period: ExpensePeriod) =>
  authenticatedPeriodQuery(period, queryExpensesByCategory);
export const getExpensesByScope = (period: ExpensePeriod) =>
  authenticatedPeriodQuery(period, queryExpensesByScope);
export const getFixedVariableBreakdown = (period: ExpensePeriod) =>
  authenticatedPeriodQuery(period, queryFixedVariableBreakdown);

export async function getRecurringExpenses() {
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) =>
    queryRecurringExpenses(database, user.id));
}

export async function getRecurringExpenseById(idInput: unknown) {
  recurringExpenseIdSchema.parse(idInput);
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) =>
    queryRecurringExpenseById(database, user.id, idInput));
}
