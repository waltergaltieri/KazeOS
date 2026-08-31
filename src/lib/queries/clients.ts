import "server-only";

import {
  and,
  asc,
  eq,
  ilike,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { withAuthenticatedDb } from "@/db";
import { charges, clients } from "@/db/schema";
import { requireUser } from "@/lib/auth/require-user";
import {
  clientFiltersSchema,
  clientIdSchema,
  type ClientFilters,
} from "@/lib/validations/client";

export interface CurrencyPair {
  USD: number;
  ARS: number;
}

export interface ClientListItem {
  id: string;
  firstName: string;
  lastName: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: "active" | "paused" | "archived";
  joinedAt: string;
  outstanding: CurrencyPair;
}

export interface ClientSummary {
  outstanding: CurrencyPair;
  collected: CurrencyPair;
  mrr: CurrencyPair;
  activeServices: number;
  pendingTasks: number;
  notes: number;
}

const numberFromSql = (value: unknown) => Number(value ?? 0);

function statusConditions(filters: ClientFilters): SQL[] {
  if (["active", "paused", "archived"].includes(filters.filter)) {
    return [
      eq(
        clients.status,
        filters.filter as "active" | "paused" | "archived",
      ),
    ];
  }

  return [ne(clients.status, "archived")];
}

function debtCondition(hasDebt: boolean): SQL {
  const expression = sql`exists (
    select 1
    from charges client_charge
    where client_charge.owner_id = ${clients.ownerId}
      and client_charge.client_id = ${clients.id}
      and client_charge.status <> 'cancelled'
      and client_charge.amount_minor > client_charge.amount_paid_minor
  )`;

  return hasDebt ? expression : sql`not (${expression})`;
}

export async function getClients(input: unknown = {}): Promise<ClientListItem[]> {
  const filters = clientFiltersSchema.parse(input);
  const user = await requireUser();

  return withAuthenticatedDb(user.id, async (db) => {
    const conditions: SQL[] = [
      eq(clients.ownerId, user.id),
      ...statusConditions(filters),
    ];

    if (filters.search) {
      const pattern = `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`;
      conditions.push(
        or(
          ilike(clients.firstName, pattern),
          ilike(clients.lastName, pattern),
          ilike(clients.company, pattern),
          ilike(clients.email, pattern),
        )!,
      );
    }

    if (filters.filter === "debt") conditions.push(debtCondition(true));
    if (filters.filter === "current") conditions.push(debtCondition(false));

    const rows = await db
      .select({
        id: clients.id,
        firstName: clients.firstName,
        lastName: clients.lastName,
        company: clients.company,
        email: clients.email,
        phone: clients.phone,
        status: clients.status,
        joinedAt: clients.joinedAt,
        outstandingUsd: sql<number>`coalesce(sum(
          case when ${charges.currency} = 'USD'
            and ${charges.status} <> 'cancelled'
            then greatest(${charges.amountMinor} - ${charges.amountPaidMinor}, 0)
            else 0 end
        ), 0)::bigint`.mapWith(numberFromSql),
        outstandingArs: sql<number>`coalesce(sum(
          case when ${charges.currency} = 'ARS'
            and ${charges.status} <> 'cancelled'
            then greatest(${charges.amountMinor} - ${charges.amountPaidMinor}, 0)
            else 0 end
        ), 0)::bigint`.mapWith(numberFromSql),
      })
      .from(clients)
      .leftJoin(
        charges,
        and(
          eq(charges.ownerId, clients.ownerId),
          eq(charges.clientId, clients.id),
        ),
      )
      .where(and(...conditions))
      .groupBy(clients.id)
      .orderBy(
        asc(sql`lower(${clients.firstName})`),
        asc(sql`lower(coalesce(${clients.lastName}, ''))`),
        asc(clients.id),
      );

    return rows.map(({ outstandingUsd, outstandingArs, ...client }) => ({
      ...client,
      outstanding: { USD: outstandingUsd, ARS: outstandingArs },
    }));
  });
}

export async function getClientById(idInput: unknown) {
  const id = clientIdSchema.parse(idInput);
  const user = await requireUser();

  return withAuthenticatedDb(user.id, async (db) => {
    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.ownerId, user.id)))
      .limit(1);

    return client ?? null;
  });
}

export async function getClientSummary(
  idInput: unknown,
): Promise<ClientSummary | null> {
  const id = clientIdSchema.parse(idInput);
  const user = await requireUser();

  return withAuthenticatedDb(user.id, async (db) => {
    const [row] = await db
      .select({
        outstandingUsd: sql<number>`(
          select coalesce(sum(greatest(c.amount_minor - c.amount_paid_minor, 0)), 0)::bigint
          from charges c where c.owner_id = ${user.id} and c.client_id = ${id}
          and c.currency = 'USD' and c.status <> 'cancelled'
        )`.mapWith(numberFromSql),
        outstandingArs: sql<number>`(
          select coalesce(sum(greatest(c.amount_minor - c.amount_paid_minor, 0)), 0)::bigint
          from charges c where c.owner_id = ${user.id} and c.client_id = ${id}
          and c.currency = 'ARS' and c.status <> 'cancelled'
        )`.mapWith(numberFromSql),
        collectedUsd: sql<number>`(
          select coalesce(sum(p.amount_minor), 0)::bigint from payments p
          where p.owner_id = ${user.id} and p.client_id = ${id} and p.currency = 'USD'
        )`.mapWith(numberFromSql),
        collectedArs: sql<number>`(
          select coalesce(sum(p.amount_minor), 0)::bigint from payments p
          where p.owner_id = ${user.id} and p.client_id = ${id} and p.currency = 'ARS'
        )`.mapWith(numberFromSql),
        mrrUsd: sql<number>`(
          select coalesce(round(sum(s.amount_minor * case s.billing_frequency
            when 'monthly' then 12 when 'quarterly' then 4 when 'yearly' then 1 else 0 end) / 12.0), 0)::bigint
          from services s where s.owner_id = ${user.id} and s.client_id = ${id}
          and s.currency = 'USD' and s.status = 'active' and s.billing_type = 'recurring'
        )`.mapWith(numberFromSql),
        mrrArs: sql<number>`(
          select coalesce(round(sum(s.amount_minor * case s.billing_frequency
            when 'monthly' then 12 when 'quarterly' then 4 when 'yearly' then 1 else 0 end) / 12.0), 0)::bigint
          from services s where s.owner_id = ${user.id} and s.client_id = ${id}
          and s.currency = 'ARS' and s.status = 'active' and s.billing_type = 'recurring'
        )`.mapWith(numberFromSql),
        activeServices: sql<number>`(
          select count(*)::integer from services s where s.owner_id = ${user.id}
          and s.client_id = ${id} and s.status = 'active'
        )`.mapWith(numberFromSql),
        pendingTasks: sql<number>`(
          select count(*)::integer from tasks t where t.owner_id = ${user.id}
          and t.client_id = ${id} and t.status = 'pending'
        )`.mapWith(numberFromSql),
        notes: sql<number>`(
          select count(*)::integer from client_notes n where n.owner_id = ${user.id}
          and n.client_id = ${id}
        )`.mapWith(numberFromSql),
      })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.ownerId, user.id)))
      .limit(1);

    if (!row) return null;

    return {
      outstanding: { USD: row.outstandingUsd, ARS: row.outstandingArs },
      collected: { USD: row.collectedUsd, ARS: row.collectedArs },
      mrr: { USD: row.mrrUsd, ARS: row.mrrArs },
      activeServices: row.activeServices,
      pendingTasks: row.pendingTasks,
      notes: row.notes,
    };
  });
}
