import "server-only";

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { withAuthenticatedDb } from "@/db";
import * as schema from "@/db/schema";
import { charges, payments } from "@/db/schema";
import { requireUser } from "@/lib/auth/require-user";
import { validateCommercialDate } from "@/lib/domain/commercial-date";
import type { AggregateMinorUnits, Currency } from "@/lib/domain/money";
import { clientIdSchema } from "@/lib/validations/client";
import type { DisplayChargeStatus } from "./charges";

type HistoryDatabase = PostgresJsDatabase<typeof schema>;

export interface ClientFinancialMovement {
  id: string;
  kind: "charge" | "payment";
  chargeId: string | null;
  date: string;
  label: string;
  amountMinor: AggregateMinorUnits;
  currency: Currency;
  status: DisplayChargeStatus | null;
}

export interface ClientFinancialHistoryResult {
  items: ClientFinancialMovement[];
  hasMore: boolean;
  limit: number;
}

export function parseHistoryLimit(input: unknown): number {
  const parsed = typeof input === "string" && /^\d+$/.test(input) ? Number(input) : 20;
  return Number.isSafeInteger(parsed) ? Math.min(100, Math.max(20, parsed)) : 20;
}

export async function queryClientFinancialHistory(
  database: HistoryDatabase,
  ownerId: string,
  clientId: string,
  asOfInput: string,
  limitInput: number,
): Promise<ClientFinancialHistoryResult> {
  const asOf = validateCommercialDate(asOfInput);
  const limit = Number.isSafeInteger(limitInput) ? Math.min(100, Math.max(1, limitInput)) : 20;
  const rows = await database.execute<{
    id: string; kind: "charge" | "payment"; charge_id: string | null;
    movement_date: string; label: string; amount_minor: string;
    currency: Currency; status: DisplayChargeStatus | null;
  }>(sql`
    select * from (
      select ${charges.id}::text as id, 'charge'::text as kind,
        ${charges.id}::text as charge_id, ${charges.dueDate}::text as movement_date,
        ${charges.description} as label, ${charges.amountMinor}::text as amount_minor,
        ${charges.currency}::text as currency,
        case
          when ${charges.status} = 'cancelled' then 'cancelled'
          when ${charges.amountPaidMinor} >= ${charges.amountMinor} then 'paid'
          when ${charges.amountPaidMinor} > 0 then 'partial'
          when ${charges.dueDate} < ${asOf} then 'overdue'
          when ${charges.dueDate} = ${asOf} then 'due_today'
          else 'pending'
        end::text as status
      from ${charges}
      where ${charges.ownerId} = ${ownerId} and ${charges.clientId} = ${clientId}
      union all
      select ${payments.id}::text as id, 'payment'::text as kind,
        ${payments.chargeId}::text as charge_id, ${payments.paymentDate}::text as movement_date,
        ('Pago · ' || case ${payments.paymentMethod}
          when 'bank_transfer' then 'Transferencia'
          when 'cash' then 'Efectivo'
          when 'mercadopago' then 'Mercado Pago'
          when 'paypal' then 'PayPal'
          when 'payoneer' then 'Payoneer'
          when 'stripe' then 'Stripe'
          when 'crypto' then 'Cripto'
          else 'Otro' end)::text as label,
        ${payments.amountMinor}::text as amount_minor, ${payments.currency}::text as currency,
        null::text as status
      from ${payments}
      where ${payments.ownerId} = ${ownerId} and ${payments.clientId} = ${clientId}
    ) movement
    order by movement_date desc, case kind when 'payment' then 0 else 1 end, id desc
    limit ${limit + 1}
  `);
  const items = rows.slice(0, limit).map((row) => {
    if (!/^(0|[1-9]\d*)$/.test(row.amount_minor) || !["USD", "ARS"].includes(row.currency)) {
      throw new RangeError("Invalid financial movement returned by database");
    }
    return {
      id: row.id,
      kind: row.kind,
      chargeId: row.charge_id,
      date: row.movement_date,
      label: row.label,
      amountMinor: row.amount_minor as AggregateMinorUnits,
      currency: row.currency,
      status: row.status,
    };
  });
  return { items, hasMore: rows.length > limit, limit };
}

export async function getClientFinancialHistory(
  clientIdInput: unknown,
  asOfInput: string,
  limitInput: number = 20,
): Promise<ClientFinancialHistoryResult> {
  const clientId = clientIdSchema.parse(clientIdInput);
  const asOf = validateCommercialDate(asOfInput);
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) =>
    queryClientFinancialHistory(database, user.id, clientId, asOf, limitInput),
  );
}
