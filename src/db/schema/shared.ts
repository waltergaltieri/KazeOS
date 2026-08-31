import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
  options: { allowDelete?: boolean } = {},
) {
  const ownsRow = sql`${authUid} = ${ownerColumn}`;
  const policies = [
    pgPolicy(`${tableName}_authenticated_select`, {
      as: "permissive",
      for: "select",
      to: authenticatedRole,
      using: ownsRow,
    }),
    pgPolicy(`${tableName}_authenticated_insert`, {
      as: "permissive",
      for: "insert",
      to: authenticatedRole,
      withCheck: ownsRow,
    }),
    pgPolicy(`${tableName}_authenticated_update`, {
      as: "permissive",
      for: "update",
      to: authenticatedRole,
      using: ownsRow,
      withCheck: ownsRow,
    }),
  ];

  if (options.allowDelete) {
    policies.push(
      pgPolicy(`${tableName}_authenticated_delete`, {
        as: "permissive",
        for: "delete",
        to: authenticatedRole,
        using: ownsRow,
      }),
    );
  }

  return policies;
}
