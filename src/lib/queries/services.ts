import "server-only";

import { and, asc, eq, getTableColumns, gte, lt, ne, sql } from "drizzle-orm";

import { withAuthenticatedDb } from "@/db";
import { charges, services } from "@/db/schema";
import { requireUser } from "@/lib/auth/require-user";
import { validateCommercialDate } from "@/lib/domain/commercial-date";
import { clientIdSchema } from "@/lib/validations/client";
import { serviceIdSchema } from "@/lib/validations/service";

export interface ServiceListItem {
  id: string;
  clientId: string;
  name: string;
  description: string | null;
  amountMinor: number;
  currency: "USD" | "ARS";
  billingType: "recurring" | "one_time";
  billingFrequency: "monthly" | "quarterly" | "yearly" | "one_time";
  billingDay: number | null;
  startDate: string;
  endDate: string | null;
  status: "active" | "paused" | "cancelled";
  automaticChargeGeneration: boolean;
  nextDueDate: string | null;
}

export async function getServices(
  clientIdInput: unknown,
  asOfInput: string,
): Promise<ServiceListItem[]> {
  const clientId = clientIdSchema.parse(clientIdInput);
  const asOf = validateCommercialDate(asOfInput);
  const user = await requireUser();

  return withAuthenticatedDb(user.id, async (database) => {
    const rows = await database
      .select({
        id: services.id,
        clientId: services.clientId,
        name: services.name,
        description: services.description,
        amountMinor: services.amountMinor,
        currency: services.currency,
        billingType: services.billingType,
        billingFrequency: services.billingFrequency,
        billingDay: services.billingDay,
        startDate: services.startDate,
        endDate: services.endDate,
        status: services.status,
        automaticChargeGeneration: services.automaticChargeGeneration,
        nextDueDate: sql<string | null>`min(${charges.dueDate}) filter (
          where ${charges.status} <> 'cancelled'
            and ${charges.amountPaidMinor} < ${charges.amountMinor}
            and ${charges.dueDate} >= ${asOf}
        )::text`,
      })
      .from(services)
      .leftJoin(
        charges,
        and(
          eq(charges.ownerId, services.ownerId),
          eq(charges.clientId, services.clientId),
          eq(charges.serviceId, services.id),
          ne(charges.status, "cancelled"),
          lt(charges.amountPaidMinor, charges.amountMinor),
          gte(charges.dueDate, asOf),
        ),
      )
      .where(
        and(
          eq(services.ownerId, user.id),
          eq(services.clientId, clientId),
        ),
      )
      .groupBy(services.id)
      .orderBy(
        asc(sql`case ${services.status} when 'active' then 0 when 'paused' then 1 else 2 end`),
        asc(sql`lower(${services.name})`),
        asc(services.id),
      );

    return rows;
  });
}

export async function getServiceById(
  clientIdInput: unknown,
  serviceIdInput: unknown,
) {
  const clientId = clientIdSchema.parse(clientIdInput);
  const serviceId = serviceIdSchema.parse(serviceIdInput);
  const user = await requireUser();

  return withAuthenticatedDb(user.id, async (database) => {
    const [service] = await database
      .select({
        ...getTableColumns(services),
        hasCharges: sql<boolean>`exists (
          select 1 from charges service_charge
          where service_charge.owner_id = ${services.ownerId}
            and service_charge.client_id = ${services.clientId}
            and service_charge.service_id = ${services.id}
        )`,
      })
      .from(services)
      .where(
        and(
          eq(services.id, serviceId),
          eq(services.clientId, clientId),
          eq(services.ownerId, user.id),
        ),
      )
      .limit(1);

    return service ?? null;
  });
}
