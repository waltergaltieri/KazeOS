import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { clients } from "./clients";
import { chargeStatusEnum, currencyEnum } from "./enums";
import { services } from "./services";
import { auditColumns, ownerIdColumn } from "./shared";

export const charges = pgTable(
  "charges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    clientId: uuid("client_id").notNull(),
    serviceId: uuid("service_id"),
    description: text("description").notNull(),
    periodKey: text("period_key"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: currencyEnum("currency").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    status: chargeStatusEnum("status").default("pending").notNull(),
    amountPaidMinor: bigint("amount_paid_minor", { mode: "number" })
      .default(0)
      .notNull(),
    generatedAutomatically: boolean("generated_automatically")
      .default(false)
      .notNull(),
    ...auditColumns(),
  },
  (table) => [
    check("charges_description_not_blank", sql`btrim(${table.description}) <> ''`),
    check("charges_amount_minor_positive", sql`${table.amountMinor} > 0`),
    check(
      "charges_amount_paid_minor_valid",
      sql`${table.amountPaidMinor} >= 0 and ${table.amountPaidMinor} <= ${table.amountMinor}`,
    ),
    check(
      "charges_period_key_consistency",
      sql`(
        (${table.periodKey} is null or (${table.serviceId} is not null and btrim(${table.periodKey}) <> ''))
        and
        (${table.generatedAutomatically} = false or (${table.serviceId} is not null and ${table.periodKey} is not null))
      )`,
    ),
    foreignKey({
      name: "charges_owner_id_client_id_clients_owner_id_id_fk",
      columns: [table.ownerId, table.clientId],
      foreignColumns: [clients.ownerId, clients.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "charges_owner_id_service_id_services_owner_id_id_fk",
      columns: [table.ownerId, table.serviceId],
      foreignColumns: [services.ownerId, services.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    unique("charges_owner_id_id_unique").on(table.ownerId, table.id),
    index("charges_owner_id_client_id_idx").on(table.ownerId, table.clientId),
    index("charges_owner_id_service_id_idx").on(table.ownerId, table.serviceId),
    index("charges_owner_id_due_date_idx").on(table.ownerId, table.dueDate),
    index("charges_owner_id_status_due_date_idx").on(
      table.ownerId,
      table.status,
      table.dueDate,
    ),
    uniqueIndex("charges_service_id_period_key_unique")
      .on(table.serviceId, table.periodKey)
      .where(sql`${table.serviceId} is not null and ${table.periodKey} is not null`),
    pgPolicy("charges_authenticated_owner_access", {
      as: "permissive",
      for: "all",
      to: authenticatedRole,
      using: sql`${authUid} = ${table.ownerId}`,
      withCheck: sql`${authUid} = ${table.ownerId}`,
    }),
  ],
).enableRLS();
