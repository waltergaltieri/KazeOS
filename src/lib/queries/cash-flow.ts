import "server-only";

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { withAuthenticatedDb } from "@/db";
import * as schema from "@/db/schema";
import { charges, expenses, payments } from "@/db/schema";
import { requireUser } from "@/lib/auth/require-user";
import { calculateMonthlyCashFlow, type MonthlyCashFlow } from "@/lib/domain/cash-flow";
import { validateCommercialDate } from "@/lib/domain/commercial-date";
import type { AggregateMinorUnits } from "@/lib/domain/money";

type CashFlowDatabase = PostgresJsDatabase<typeof schema>;

interface CashFlowAggregateRow extends Record<string, unknown> {
  projected_income_usd: AggregateMinorUnits;
  projected_income_ars: AggregateMinorUnits;
  actual_income_usd: AggregateMinorUnits;
  actual_income_ars: AggregateMinorUnits;
  projected_expenses_usd: AggregateMinorUnits;
  projected_expenses_ars: AggregateMinorUnits;
  actual_expenses_usd: AggregateMinorUnits;
  actual_expenses_ars: AggregateMinorUnits;
}

function validatePeriod(startInput: string, endInput: string) {
  const start = validateCommercialDate(startInput);
  const end = validateCommercialDate(endInput);
  if (start >= end) throw new RangeError("Cash-flow period must be non-empty");
  return { start, end };
}

export async function queryMonthlyCashFlow(
  database: CashFlowDatabase,
  ownerId: string,
  startInput: string,
  endInput: string,
): Promise<MonthlyCashFlow> {
  const { start, end } = validatePeriod(startInput, endInput);
  const rows = await database.execute<CashFlowAggregateRow>(sql`
    with projected_income as (
      select
        coalesce(sum(${charges.amountMinor}) filter (where ${charges.currency} = 'USD'), 0)::text as usd,
        coalesce(sum(${charges.amountMinor}) filter (where ${charges.currency} = 'ARS'), 0)::text as ars
      from ${charges}
      where ${charges.ownerId} = ${ownerId}
        and ${charges.status} <> 'cancelled'
        and ${charges.dueDate} >= ${start}
        and ${charges.dueDate} < ${end}
    ), actual_income as (
      select
        coalesce(sum(${payments.amountMinor}) filter (where ${payments.currency} = 'USD'), 0)::text as usd,
        coalesce(sum(${payments.amountMinor}) filter (where ${payments.currency} = 'ARS'), 0)::text as ars
      from ${payments}
      where ${payments.ownerId} = ${ownerId}
        and ${payments.paymentDate} >= ${start}
        and ${payments.paymentDate} < ${end}
    ), projected_expenses as (
      select
        coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = 'USD'), 0)::text as usd,
        coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = 'ARS'), 0)::text as ars
      from ${expenses}
      where ${expenses.ownerId} = ${ownerId}
        and ${expenses.status} <> 'cancelled'
        and ${expenses.dueDate} >= ${start}
        and ${expenses.dueDate} < ${end}
    ), actual_expenses as (
      select
        coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = 'USD'), 0)::text as usd,
        coalesce(sum(${expenses.amountMinor}) filter (where ${expenses.currency} = 'ARS'), 0)::text as ars
      from ${expenses}
      where ${expenses.ownerId} = ${ownerId}
        and ${expenses.status} = 'paid'
        and ${expenses.paidDate} >= ${start}
        and ${expenses.paidDate} < ${end}
    )
    select
      projected_income.usd as projected_income_usd,
      projected_income.ars as projected_income_ars,
      actual_income.usd as actual_income_usd,
      actual_income.ars as actual_income_ars,
      projected_expenses.usd as projected_expenses_usd,
      projected_expenses.ars as projected_expenses_ars,
      actual_expenses.usd as actual_expenses_usd,
      actual_expenses.ars as actual_expenses_ars
    from projected_income
    cross join actual_income
    cross join projected_expenses
    cross join actual_expenses
  `);
  const row = rows[0];
  if (!row) throw new Error("Cash-flow query returned no row");

  return calculateMonthlyCashFlow({
    projectedIncome: {
      USD: row.projected_income_usd,
      ARS: row.projected_income_ars,
    },
    actualIncome: {
      USD: row.actual_income_usd,
      ARS: row.actual_income_ars,
    },
    projectedExpenses: {
      USD: row.projected_expenses_usd,
      ARS: row.projected_expenses_ars,
    },
    actualExpenses: {
      USD: row.actual_expenses_usd,
      ARS: row.actual_expenses_ars,
    },
  });
}

export async function getMonthlyCashFlow(startInput: string, endInput: string) {
  validatePeriod(startInput, endInput);
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) =>
    queryMonthlyCashFlow(database, user.id, startInput, endInput));
}
