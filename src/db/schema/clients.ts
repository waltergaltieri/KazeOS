import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { clientStatusEnum } from "./enums";
import { auditColumns, ownerIdColumn } from "./shared";

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
      .default(sql`current_date`)
      .notNull(),
    ...auditColumns(),
  },
  (table) => [
    check("clients_first_name_not_blank", sql`btrim(${table.firstName}) <> ''`),
    unique("clients_owner_id_id_unique").on(table.ownerId, table.id),
    index("clients_owner_id_status_idx").on(table.ownerId, table.status),
    pgPolicy("clients_authenticated_owner_access", {
      as: "permissive",
      for: "all",
      to: authenticatedRole,
      using: sql`${authUid} = ${table.ownerId}`,
      withCheck: sql`${authUid} = ${table.ownerId}`,
    }),
  ],
).enableRLS();
