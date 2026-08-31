import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { clientStatusEnum } from "./enums";
import {
  auditColumns,
  authenticatedOwnerPolicies,
  ownerIdColumn,
} from "./shared";

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name"),
    company: text("company"),
    email: text("email"),
    phone: text("phone"),
    whatsapp: text("whatsapp"),
    taxId: text("tax_id"),
    website: text("website"),
    address: text("address"),
    notes: text("notes"),
    status: clientStatusEnum("status").default("active").notNull(),
    joinedAt: date("joined_at", { mode: "string" })
      .default(
        sql`(now() at time zone 'America/Argentina/Buenos_Aires')::date`,
      )
      .notNull(),
    ...auditColumns(),
  },
  (table) => [
    check("clients_first_name_not_blank", sql`btrim(${table.firstName}) <> ''`),
    unique("clients_owner_id_id_unique").on(table.ownerId, table.id),
    index("clients_owner_id_status_idx").on(table.ownerId, table.status),
    ...authenticatedOwnerPolicies("clients", table.ownerId),
  ],
).enableRLS();
