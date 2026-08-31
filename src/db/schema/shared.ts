import { timestamp, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

export function ownerIdColumn() {
  return uuid("owner_id")
    .notNull()
    .references(() => authUsers.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    });
}

export function auditColumns() {
  return {
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "date",
    })
      .defaultNow()
      .notNull(),
  };
}
