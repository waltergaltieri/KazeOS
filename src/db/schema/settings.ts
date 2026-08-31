import { sql } from "drizzle-orm";
import { check, pgPolicy, pgTable, text } from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import { currencyEnum } from "./enums";
import { auditColumns, ownerIdColumn } from "./shared";

export const settings = pgTable(
  "settings",
  {
    ownerId: ownerIdColumn().primaryKey(),
    primaryCurrency: currencyEnum("primary_currency").default("USD").notNull(),
    timezone: text("timezone")
      .default("America/Argentina/Buenos_Aires")
      .notNull(),
    dateFormat: text("date_format").default("dd/MM/yyyy").notNull(),
    businessName: text("business_name"),
    businessInfo: text("business_info"),
    ...auditColumns(),
  },
  (table) => [
    check("settings_timezone_not_blank", sql`btrim(${table.timezone}) <> ''`),
    check("settings_date_format_not_blank", sql`btrim(${table.dateFormat}) <> ''`),
    pgPolicy("settings_authenticated_owner_access", {
      as: "permissive",
      for: "all",
      to: authenticatedRole,
      using: sql`${authUid} = ${table.ownerId}`,
      withCheck: sql`${authUid} = ${table.ownerId}`,
    }),
  ],
).enableRLS();
