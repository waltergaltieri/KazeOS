import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  type PgRole,
  pgPolicy,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid, authUsers } from "drizzle-orm/supabase";

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

export function authenticatedOwnerPolicies(
  tableName: string,
  ownerColumn: AnyPgColumn,
  options: {
    allowDelete?: boolean;
    writePolicyAudience?: string;
    writeRole?: PgRole;
  } = {},
) {
  const ownsRow = sql`${authUid} = ${ownerColumn}`;
  const writePolicyAudience =
    options.writePolicyAudience ?? "authenticated";
  const writeRole = options.writeRole ?? authenticatedRole;
  const policies = [
    pgPolicy(`${tableName}_authenticated_select`, {
      as: "permissive",
      for: "select",
      to: authenticatedRole,
      using: ownsRow,
    }),
    pgPolicy(`${tableName}_${writePolicyAudience}_insert`, {
      as: "permissive",
      for: "insert",
      to: writeRole,
      withCheck: ownsRow,
    }),
    pgPolicy(`${tableName}_${writePolicyAudience}_update`, {
      as: "permissive",
      for: "update",
      to: writeRole,
      using: ownsRow,
      withCheck: ownsRow,
    }),
  ];

  if (options.allowDelete) {
    policies.push(
      pgPolicy(`${tableName}_${writePolicyAudience}_delete`, {
        as: "permissive",
        for: "delete",
        to: writeRole,
        using: ownsRow,
      }),
    );
  }

  return policies;
}
