import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  auditColumns,
  authenticatedOwnerPolicies,
  ownerIdColumn,
} from "./shared";
import { kazeosBackendRole } from "./roles";

export const expenseCategories = pgTable(
  "expense_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    name: text("name").notNull(),
    icon: text("icon"),
    active: boolean("active").default(true).notNull(),
    ...auditColumns(),
  },
  (table) => [
    check(
      "expense_categories_name_not_blank",
      sql`btrim(${table.name}) <> ''`,
    ),
    unique("expense_categories_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    uniqueIndex("expense_categories_owner_name_unique").on(
      table.ownerId,
      sql`lower(${table.name})`,
    ),
    ...authenticatedOwnerPolicies("expense_categories", table.ownerId, {
      writePolicyAudience: "backend",
      writeRole: kazeosBackendRole,
    }),
  ],
).enableRLS();
