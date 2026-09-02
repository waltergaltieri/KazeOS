import "server-only";

import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { withAuthenticatedDb } from "@/db";
import * as schema from "@/db/schema";
import { charges, clients, payments, services, tasks } from "@/db/schema";
import { requireUser } from "@/lib/auth/require-user";
import { validateCommercialDate } from "@/lib/domain/commercial-date";
import type { AggregateMinorUnits, Currency } from "@/lib/domain/money";
import type { DisplayChargeStatus } from "./charges";

type DashboardDatabase = PostgresJsDatabase<typeof schema>;
type MoneyByCurrency = Record<Currency, AggregateMinorUnits>;

export interface DashboardMetrics {
  collectedThisMonth: MoneyByCurrency;
  pending: MoneyByCurrency;
  overdue: MoneyByCurrency;
  mrr: MoneyByCurrency;
  activeClients: number;
  chargesNextSevenDays: number;
}

export interface DashboardCharge {
  id: string;
  clientId: string;
  clientName: string;
  description: string;
  amountMinor: number;
  amountPaidMinor: number;
  outstandingMinor: AggregateMinorUnits;
  currency: Currency;
  dueDate: string;
  status: DisplayChargeStatus;
  isOverdue: boolean;
}

export interface DashboardTask {
  id: string;
  clientId: string | null;
  clientName: string | null;
  title: string;
  dueDate: string | null;
  priority: "low" | "medium" | "high";
  isOverdue: boolean;
}

export interface DashboardMovement {
  id: string;
  kind: "charge" | "task";
  label: string;
  context: string | null;
  date: string | null;
  amountMinor: AggregateMinorUnits | null;
  currency: Currency | null;
  priority: "low" | "medium" | "high" | null;
  isOverdue: boolean;
}

export interface MonthlyRevenuePoint {
  month: string;
  USD: AggregateMinorUnits;
  ARS: AggregateMinorUnits;
}

const zeroMoney = (): MoneyByCurrency => ({ USD: "0", ARS: "0" });

function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function monthKeysEndingAt(date: string): string[] {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  const sourceIndex = year * 12 + month - 1;
  return Array.from({ length: 6 }, (_, index) => {
    const monthIndex = sourceIndex - (5 - index);
    const pointYear = Math.floor(monthIndex / 12);
    const pointMonth = (monthIndex % 12) + 1;
    return `${pointYear.toString().padStart(4, "0")}-${pointMonth.toString().padStart(2, "0")}`;
  });
}

export async function queryDashboardMetrics(
  database: DashboardDatabase,
  ownerId: string,
  asOfInput: string,
): Promise<DashboardMetrics> {
  const asOf = validateCommercialDate(asOfInput);
  const monthStart = startOfMonth(asOf);
  const rows = await database.execute<{
    collected_usd: AggregateMinorUnits;
    collected_ars: AggregateMinorUnits;
    pending_usd: AggregateMinorUnits;
    pending_ars: AggregateMinorUnits;
    overdue_usd: AggregateMinorUnits;
    overdue_ars: AggregateMinorUnits;
    mrr_usd: AggregateMinorUnits;
    mrr_ars: AggregateMinorUnits;
    active_clients: number;
    upcoming_count: number;
  }>(sql`
    select
      coalesce((select sum(amount_minor) filter (where currency = 'USD') from ${payments} where owner_id = ${ownerId} and payment_date >= ${monthStart} and payment_date <= ${asOf}), 0)::text as collected_usd,
      coalesce((select sum(amount_minor) filter (where currency = 'ARS') from ${payments} where owner_id = ${ownerId} and payment_date >= ${monthStart} and payment_date <= ${asOf}), 0)::text as collected_ars,
      coalesce((select sum(greatest(amount_minor - amount_paid_minor, 0)) filter (where currency = 'USD') from ${charges} where owner_id = ${ownerId} and status <> 'cancelled' and amount_paid_minor < amount_minor and due_date >= ${monthStart} and due_date < (${monthStart}::date + interval '1 month')), 0)::text as pending_usd,
      coalesce((select sum(greatest(amount_minor - amount_paid_minor, 0)) filter (where currency = 'ARS') from ${charges} where owner_id = ${ownerId} and status <> 'cancelled' and amount_paid_minor < amount_minor and due_date >= ${monthStart} and due_date < (${monthStart}::date + interval '1 month')), 0)::text as pending_ars,
      coalesce((select sum(greatest(amount_minor - amount_paid_minor, 0)) filter (where currency = 'USD') from ${charges} where owner_id = ${ownerId} and status <> 'cancelled' and amount_paid_minor < amount_minor and due_date < ${asOf}), 0)::text as overdue_usd,
      coalesce((select sum(greatest(amount_minor - amount_paid_minor, 0)) filter (where currency = 'ARS') from ${charges} where owner_id = ${ownerId} and status <> 'cancelled' and amount_paid_minor < amount_minor and due_date < ${asOf}), 0)::text as overdue_ars,
      coalesce((select floor((coalesce(sum(case billing_frequency when 'monthly' then amount_minor * 12 when 'quarterly' then amount_minor * 4 when 'yearly' then amount_minor else 0 end) filter (where currency = 'USD'), 0) + 6) / 12) from ${services} where owner_id = ${ownerId} and status = 'active' and billing_type = 'recurring'), 0)::text as mrr_usd,
      coalesce((select floor((coalesce(sum(case billing_frequency when 'monthly' then amount_minor * 12 when 'quarterly' then amount_minor * 4 when 'yearly' then amount_minor else 0 end) filter (where currency = 'ARS'), 0) + 6) / 12) from ${services} where owner_id = ${ownerId} and status = 'active' and billing_type = 'recurring'), 0)::text as mrr_ars,
      (select count(*)::int from ${clients} where owner_id = ${ownerId} and status = 'active') as active_clients,
      (select count(*)::int from ${charges} where owner_id = ${ownerId} and status <> 'cancelled' and amount_paid_minor < amount_minor and due_date >= ${asOf} and due_date < (${asOf}::date + interval '7 days')) as upcoming_count
  `);
  const row = rows[0];
  if (!row) throw new Error("Dashboard metrics query returned no row");
  return {
    collectedThisMonth: { USD: row.collected_usd, ARS: row.collected_ars },
    pending: { USD: row.pending_usd, ARS: row.pending_ars },
    overdue: { USD: row.overdue_usd, ARS: row.overdue_ars },
    mrr: { USD: row.mrr_usd, ARS: row.mrr_ars },
    activeClients: row.active_clients,
    chargesNextSevenDays: row.upcoming_count,
  };
}

const chargeDisplayStatus = (asOf: string) => sql<DisplayChargeStatus>`case
  when ${charges.status} = 'cancelled' then 'cancelled'
  when ${charges.amountPaidMinor} >= ${charges.amountMinor} then 'paid'
  when ${charges.amountPaidMinor} > 0 then 'partial'
  when ${charges.dueDate} < ${asOf} then 'overdue'
  when ${charges.dueDate} = ${asOf} then 'due_today'
  else 'pending' end`;

export async function queryUpcomingCharges(
  database: DashboardDatabase,
  ownerId: string,
  asOfInput: string,
): Promise<DashboardCharge[]> {
  const asOf = validateCommercialDate(asOfInput);
  return database.select({
    id: charges.id,
    clientId: charges.clientId,
    clientName: sql<string>`trim(concat_ws(' ', ${clients.firstName}, ${clients.lastName}))`,
    description: charges.description,
    amountMinor: charges.amountMinor,
    amountPaidMinor: charges.amountPaidMinor,
    outstandingMinor: sql<AggregateMinorUnits>`greatest(${charges.amountMinor} - ${charges.amountPaidMinor}, 0)::text`,
    currency: charges.currency,
    dueDate: charges.dueDate,
    status: chargeDisplayStatus(asOf),
    isOverdue: sql<boolean>`${charges.dueDate} < ${asOf}`,
  }).from(charges)
    .innerJoin(clients, and(eq(clients.ownerId, charges.ownerId), eq(clients.id, charges.clientId)))
    .where(and(eq(charges.ownerId, ownerId), ne(charges.status, "cancelled"), sql`${charges.amountPaidMinor} < ${charges.amountMinor}`))
    .orderBy(sql`case when ${charges.dueDate} < ${asOf} then 0 else 1 end`, asc(charges.dueDate), asc(charges.id))
    .limit(5);
}

export async function queryPendingTasks(
  database: DashboardDatabase,
  ownerId: string,
  asOfInput: string,
): Promise<DashboardTask[]> {
  const asOf = validateCommercialDate(asOfInput);
  return database.select({
    id: tasks.id,
    clientId: tasks.clientId,
    clientName: sql<string | null>`case when ${clients.id} is null then null else trim(concat_ws(' ', ${clients.firstName}, ${clients.lastName})) end`,
    title: tasks.title,
    dueDate: tasks.dueDate,
    priority: tasks.priority,
    isOverdue: sql<boolean>`coalesce(${tasks.dueDate} < ${asOf}, false)`,
  }).from(tasks)
    .leftJoin(clients, and(eq(clients.ownerId, tasks.ownerId), eq(clients.id, tasks.clientId)))
    .where(and(eq(tasks.ownerId, ownerId), eq(tasks.status, "pending")))
    .orderBy(sql`case when ${tasks.dueDate} is null then 1 else 0 end`, asc(tasks.dueDate), sql`case ${tasks.priority} when 'high' then 0 when 'medium' then 1 else 2 end`, asc(tasks.id))
    .limit(5);
}

export async function queryUpcomingMovements(
  database: DashboardDatabase,
  ownerId: string,
  asOfInput: string,
): Promise<DashboardMovement[]> {
  const asOf = validateCommercialDate(asOfInput);
  const rows = await database.execute<{
    id: string;
    kind: "charge" | "task";
    label: string;
    context: string | null;
    movement_date: string | null;
    amount_minor: AggregateMinorUnits | null;
    currency: Currency | null;
    priority: "low" | "medium" | "high" | null;
    is_overdue: boolean;
  }>(sql`
    select * from (
      select ${charges.id}::text as id, 'charge'::text as kind, ${charges.description} as label,
        trim(concat_ws(' ', ${clients.firstName}, ${clients.lastName})) as context,
        ${charges.dueDate}::text as movement_date,
        greatest(${charges.amountMinor} - ${charges.amountPaidMinor}, 0)::text as amount_minor,
        ${charges.currency}::text as currency, null::text as priority,
        (${charges.dueDate} < ${asOf}) as is_overdue
      from ${charges}
      inner join ${clients} on ${clients.ownerId} = ${charges.ownerId} and ${clients.id} = ${charges.clientId}
      where ${charges.ownerId} = ${ownerId} and ${charges.status} <> 'cancelled' and ${charges.amountPaidMinor} < ${charges.amountMinor}
      union all
      select ${tasks.id}::text as id, 'task'::text as kind, ${tasks.title} as label,
        case when ${clients.id} is null then null else trim(concat_ws(' ', ${clients.firstName}, ${clients.lastName})) end as context,
        ${tasks.dueDate}::text as movement_date, null::text as amount_minor, null::text as currency,
        ${tasks.priority}::text as priority, coalesce(${tasks.dueDate} < ${asOf}, false) as is_overdue
      from ${tasks}
      left join ${clients} on ${clients.ownerId} = ${tasks.ownerId} and ${clients.id} = ${tasks.clientId}
      where ${tasks.ownerId} = ${ownerId} and ${tasks.status} = 'pending'
    ) movements
    order by case when movement_date is null then 1 else 0 end, movement_date,
      case kind when 'charge' then 0 else 1 end, id
    limit 8
  `);
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    context: row.context,
    date: row.movement_date,
    amountMinor: row.amount_minor,
    currency: row.currency,
    priority: row.priority,
    isOverdue: row.is_overdue,
  }));
}

export async function queryMonthlyRevenue(
  database: DashboardDatabase,
  ownerId: string,
  asOfInput: string,
): Promise<MonthlyRevenuePoint[]> {
  const asOf = validateCommercialDate(asOfInput);
  const months = monthKeysEndingAt(asOf);
  const firstDate = `${months[0]}-01`;
  const rows = await database.select({
    month: sql<string>`to_char(${payments.paymentDate}, 'YYYY-MM')`,
    currency: payments.currency,
    amountMinor: sql<AggregateMinorUnits>`sum(${payments.amountMinor})::text`,
  }).from(payments)
    .where(and(eq(payments.ownerId, ownerId), sql`${payments.paymentDate} >= ${firstDate}`, sql`${payments.paymentDate} <= ${asOf}`))
    .groupBy(sql`to_char(${payments.paymentDate}, 'YYYY-MM')`, payments.currency)
    .orderBy(asc(sql`to_char(${payments.paymentDate}, 'YYYY-MM')`), asc(payments.currency));
  const points = new Map(months.map((month) => [month, { month, ...zeroMoney() }]));
  for (const row of rows) points.get(row.month)![row.currency] = row.amountMinor;
  return months.map((month) => points.get(month)!);
}

async function authenticated<TResult>(
  asOfInput: string,
  query: (database: DashboardDatabase, ownerId: string, asOf: string) => Promise<TResult>,
): Promise<TResult> {
  const asOf = validateCommercialDate(asOfInput);
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) => query(database, user.id, asOf));
}

export const getDashboardMetrics = (asOf: string) => authenticated(asOf, queryDashboardMetrics);
export const getUpcomingCharges = (asOf: string) => authenticated(asOf, queryUpcomingCharges);
export const getPendingTasks = (asOf: string) => authenticated(asOf, queryPendingTasks);
export const getUpcomingMovements = (asOf: string) => authenticated(asOf, queryUpcomingMovements);
export const getMonthlyRevenue = (asOf: string) => authenticated(asOf, queryMonthlyRevenue);
