import "server-only";

import { and, asc, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { withAuthenticatedDb } from "@/db";
import * as schema from "@/db/schema";
import { charges, clients, payments, services } from "@/db/schema";
import { requireUser } from "@/lib/auth/require-user";
import { validateCommercialDate } from "@/lib/domain/commercial-date";
import { chargeFiltersSchema, chargeIdSchema, type ChargeFilters } from "@/lib/validations/charge";

export type DisplayChargeStatus = "pending" | "due_today" | "overdue" | "partial" | "paid" | "cancelled";
export type PersistedChargeStatus = "pending" | "partial" | "paid" | "cancelled";
export interface ChargeListItem {
  id: string; clientId: string; clientName: string; serviceId: string | null; serviceName: string | null;
  description: string; amountMinor: number; amountPaidMinor: number; currency: "USD" | "ARS"; dueDate: string;
  status: DisplayChargeStatus; persistedStatus: PersistedChargeStatus; generatedAutomatically: boolean;
}

export interface ChargeFilterOptions {
  clients: Array<{ id: string; label: string }>;
  services: Array<{ id: string; label: string }>;
}

type ChargeQueryDatabase = PostgresJsDatabase<typeof schema>;

const displayStatus = (today: string) => sql<DisplayChargeStatus>`case
  when ${charges.status} = 'cancelled' then 'cancelled'
  when ${charges.amountPaidMinor} >= ${charges.amountMinor} then 'paid'
  when ${charges.amountPaidMinor} > 0 then 'partial'
  when ${charges.dueDate} < ${today} then 'overdue'
  when ${charges.dueDate} = ${today} then 'due_today'
  else 'pending' end`;

function monthBounds(today: string) {
  const [year, month] = today.split("-").map(Number);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const next = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { start, next };
}

function filterConditions(filters: ChargeFilters, today: string): SQL[] {
  const conditions: SQL[] = [];
  if (filters.clientId) conditions.push(eq(charges.clientId, filters.clientId));
  if (filters.serviceId) conditions.push(eq(charges.serviceId, filters.serviceId));
  if (filters.currency) conditions.push(eq(charges.currency, filters.currency));
  if (filters.from) conditions.push(gte(charges.dueDate, filters.from));
  if (filters.to) conditions.push(lte(charges.dueDate, filters.to));
  if (filters.search) {
    const term = `%${filters.search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    conditions.push(or(ilike(charges.description, term), ilike(clients.firstName, term), ilike(clients.lastName, term), ilike(clients.company, term))!);
  }
  const derived = displayStatus(today);
  if (["due_today", "overdue", "partial", "paid"].includes(filters.status)) conditions.push(sql`${derived} = ${filters.status}`);
  if (filters.status === "upcoming") conditions.push(and(sql`${derived} = 'pending'`, sql`${charges.dueDate} > ${today}`)!);
  if (filters.status === "current_month") {
    const { start, next } = monthBounds(today);
    conditions.push(and(gte(charges.dueDate, start), sql`${charges.dueDate} < ${next}`)!);
  }
  return conditions;
}

export async function queryCharges(database: ChargeQueryDatabase, ownerId: string, input: unknown = {}, asOfInput: string): Promise<ChargeListItem[]> {
  const filters = chargeFiltersSchema.parse(input);
  const today = validateCommercialDate(asOfInput);
  return database.select({
    id: charges.id, clientId: charges.clientId,
      clientName: sql<string>`coalesce(nullif(btrim(${clients.company}), ''), trim(concat_ws(' ', ${clients.firstName}, ${clients.lastName})))`,
    serviceId: charges.serviceId, serviceName: services.name, description: charges.description,
    amountMinor: charges.amountMinor, amountPaidMinor: charges.amountPaidMinor, currency: charges.currency,
    dueDate: charges.dueDate, status: displayStatus(today), persistedStatus: charges.status, generatedAutomatically: charges.generatedAutomatically,
  }).from(charges)
    .innerJoin(clients, and(eq(clients.ownerId, charges.ownerId), eq(clients.id, charges.clientId)))
    .leftJoin(services, and(eq(services.ownerId, charges.ownerId), eq(services.id, charges.serviceId)))
    .where(and(eq(charges.ownerId, ownerId), ...filterConditions(filters, today)))
    .orderBy(asc(charges.dueDate), asc(charges.id));
}

export async function getCharges(input: unknown = {}, asOfInput: string): Promise<ChargeListItem[]> {
  chargeFiltersSchema.parse(input);
  validateCommercialDate(asOfInput);
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) => queryCharges(database, user.id, input, asOfInput));
}

export async function getChargeById(idInput: unknown, asOfInput: string) {
  const id = chargeIdSchema.parse(idInput);
  const today = validateCommercialDate(asOfInput);
  const user = await requireUser();
  return withAuthenticatedDb(user.id, async (database) => {
    const [charge] = await database.select({
      id: charges.id, clientId: charges.clientId, clientName: sql<string>`trim(concat_ws(' ', ${clients.firstName}, ${clients.lastName}))`,
      serviceId: charges.serviceId, serviceName: services.name, description: charges.description, amountMinor: charges.amountMinor,
      amountPaidMinor: charges.amountPaidMinor, currency: charges.currency, dueDate: charges.dueDate, status: displayStatus(today), persistedStatus: charges.status,
      generatedAutomatically: charges.generatedAutomatically,
    }).from(charges).innerJoin(clients, and(eq(clients.ownerId, charges.ownerId), eq(clients.id, charges.clientId)))
      .leftJoin(services, and(eq(services.ownerId, charges.ownerId), eq(services.id, charges.serviceId)))
      .where(and(eq(charges.id, id), eq(charges.ownerId, user.id))).limit(1);
    if (!charge) return null;
    const history = await database.select({ id: payments.id, amountMinor: payments.amountMinor, currency: payments.currency, paymentDate: payments.paymentDate, paymentMethod: payments.paymentMethod, reference: payments.reference, notes: payments.notes, createdAt: payments.createdAt })
      .from(payments).where(and(eq(payments.ownerId, user.id), eq(payments.chargeId, id))).orderBy(desc(payments.paymentDate), desc(payments.createdAt), desc(payments.id));
    return { ...charge, payments: history };
  });
}

export async function queryChargeSummary(database: ChargeQueryDatabase, ownerId: string, input: unknown = {}, asOfInput: string) {
  const filters = chargeFiltersSchema.parse(input);
  const today = validateCommercialDate(asOfInput);
  return database.select({
    currency: charges.currency,
    totalMinor: sql<string>`coalesce(sum(${charges.amountMinor}), 0)::text`,
    paidMinor: sql<string>`coalesce(sum(${charges.amountPaidMinor}), 0)::text`,
    outstandingMinor: sql<string>`coalesce(sum(greatest(${charges.amountMinor} - ${charges.amountPaidMinor}, 0)) filter (where ${charges.status} <> 'cancelled'), 0)::text`,
  }).from(charges).innerJoin(clients, and(eq(clients.ownerId, charges.ownerId), eq(clients.id, charges.clientId)))
    .where(and(eq(charges.ownerId, ownerId), ...filterConditions(filters, today))).groupBy(charges.currency).orderBy(asc(charges.currency));
}

export async function getChargeSummary(input: unknown = {}, asOfInput: string) {
  chargeFiltersSchema.parse(input);
  validateCommercialDate(asOfInput);
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) => queryChargeSummary(database, user.id, input, asOfInput));
}

export async function getChargeFilterOptions(): Promise<ChargeFilterOptions> {
  const user = await requireUser();
  return withAuthenticatedDb(user.id, async (database) => {
    const [clientOptions, serviceOptions] = await Promise.all([
      database.select({
        id: clients.id,
        label: sql<string>`trim(concat_ws(' ', ${clients.firstName}, ${clients.lastName})) || case when ${clients.company} is not null then ' · ' || ${clients.company} else '' end`,
      }).from(clients).where(eq(clients.ownerId, user.id)).orderBy(asc(sql`lower(${clients.firstName})`), asc(clients.id)),
      database.select({
        id: services.id,
        label: sql<string>`${services.name} || ' · ' || trim(concat_ws(' ', ${clients.firstName}, ${clients.lastName}))`,
      }).from(services).innerJoin(clients, and(eq(clients.id, services.clientId), eq(clients.ownerId, services.ownerId))).where(eq(services.ownerId, user.id)).orderBy(asc(sql`lower(${services.name})`), asc(services.id)),
    ]);
    return { clients: clientOptions, services: serviceOptions };
  });
}
