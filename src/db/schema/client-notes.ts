import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { clients } from "./clients";
import { auditColumns, ownerIdColumn } from "./shared";

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
    index("client_notes_owner_id_client_id_idx").on(
      table.ownerId,
      table.clientId,
    ),
    pgPolicy("client_notes_authenticated_owner_access", {
      as: "permissive",
      for: "all",
      to: authenticatedRole,
      using: sql`${authUid} = ${table.ownerId}`,
      withCheck: sql`${authUid} = ${table.ownerId}`,
    }),
  ],
).enableRLS();
