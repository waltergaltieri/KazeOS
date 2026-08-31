import { sql } from "drizzle-orm";
import { check, pgPolicy, pgTable, text, uuid } from "drizzle-orm/pg-core";
import {
  authenticatedRole,
  authUid,
  authUsers,
} from "drizzle-orm/supabase";

import { auditColumns } from "./shared";

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => authUsers.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    fullName: text("full_name").notNull(),
    email: text("email").notNull(),
    ...auditColumns(),
  },
  (table) => [
    check("profiles_full_name_not_blank", sql`btrim(${table.fullName}) <> ''`),
    check("profiles_email_not_blank", sql`btrim(${table.email}) <> ''`),
    pgPolicy("profiles_authenticated_access", {
      as: "permissive",
      for: "all",
      to: authenticatedRole,
      using: sql`${authUid} = ${table.id}`,
      withCheck: sql`${authUid} = ${table.id}`,
    }),
  ],
).enableRLS();
