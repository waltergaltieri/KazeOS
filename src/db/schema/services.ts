import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { clients } from "./clients";
import {
  billingFrequencyEnum,
  billingTypeEnum,
  currencyEnum,
  serviceStatusEnum,
} from "./enums";
import { auditColumns, ownerIdColumn } from "./shared";

export const services = pgTable(
  "services",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    clientId: uuid("client_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    billingType: billingTypeEnum("billing_type").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: currencyEnum("currency").notNull(),
    billingFrequency: billingFrequencyEnum("billing_frequency").notNull(),
    billingDay: integer("billing_day"),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    status: serviceStatusEnum("status").default("active").notNull(),
    automaticChargeGeneration: boolean("automatic_charge_generation")
      .default(false)
      .notNull(),
    ...auditColumns(),
  },
  (table) => [
    check("services_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("services_amount_minor_positive", sql`${table.amountMinor} > 0`),
    check(
      "services_billing_day_range",
      sql`${table.billingDay} is null or ${table.billingDay} between 1 and 31`,
    ),
    check(
      "services_end_date_valid",
      sql`${table.endDate} is null or ${table.endDate} >= ${table.startDate}`,
    ),
    check(
      "services_billing_consistency",
      sql`(
        (${table.billingType} = 'one_time' and ${table.billingFrequency} = 'one_time' and ${table.billingDay} is null and ${table.automaticChargeGeneration} = false)
        or
        (${table.billingType} = 'recurring' and ${table.billingFrequency} <> 'one_time' and ${table.billingDay} is not null)
      )`,
    ),
    foreignKey({
      name: "services_owner_id_client_id_clients_owner_id_id_fk",
      columns: [table.ownerId, table.clientId],
      foreignColumns: [clients.ownerId, clients.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    unique("services_owner_id_id_unique").on(table.ownerId, table.id),
    index("services_owner_id_client_id_idx").on(table.ownerId, table.clientId),
    index("services_owner_id_status_idx").on(table.ownerId, table.status),
    pgPolicy("services_authenticated_owner_access", {
      as: "permissive",
      for: "all",
      to: authenticatedRole,
      using: sql`${authUid} = ${table.ownerId}`,
      withCheck: sql`${authUid} = ${table.ownerId}`,
    }),
  ],
).enableRLS();
