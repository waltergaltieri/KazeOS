import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { clients } from "./clients";
import {
  auditColumns,
  authenticatedOwnerPolicies,
  ownerIdColumn,
} from "./shared";

export const clientNotes = pgTable(
  "client_notes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    clientId: uuid("client_id").notNull(),
    content: text("content").notNull(),
    ...auditColumns(),
  },
  (table) => [
    check("client_notes_content_not_blank", sql`btrim(${table.content}) <> ''`),
    foreignKey({
      name: "client_notes_owner_id_client_id_clients_owner_id_id_fk",
      columns: [table.ownerId, table.clientId],
      foreignColumns: [clients.ownerId, clients.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    index("client_notes_owner_client_created_idx").on(
      table.ownerId,
      table.clientId,
      table.createdAt.desc(),
    ),
    ...authenticatedOwnerPolicies("client_notes", table.ownerId, {
      allowDelete: true,
    }),
  ],
).enableRLS();
