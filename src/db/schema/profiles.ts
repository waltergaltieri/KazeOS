import { sql } from "drizzle-orm";
import { check, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

import { auditColumns, authenticatedOwnerPolicies } from "./shared";

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
    // Display/search snapshot only. auth.users.email remains authoritative.
    email: text("email").notNull(),
    ...auditColumns(),
  },
  (table) => [
    check("profiles_full_name_not_blank", sql`btrim(${table.fullName}) <> ''`),
    check("profiles_email_not_blank", sql`btrim(${table.email}) <> ''`),
    ...authenticatedOwnerPolicies("profiles", table.id),
  ],
).enableRLS();
