import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { clients } from "./clients";
import {
  taskPriorityEnum,
  taskRecurrenceEnum,
  taskStatusEnum,
} from "./enums";
import {
  auditColumns,
  authenticatedOwnerPolicies,
  ownerIdColumn,
} from "./shared";

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    clientId: uuid("client_id"),
    title: text("title").notNull(),
    description: text("description"),
    dueDate: date("due_date", { mode: "string" }),
    priority: taskPriorityEnum("priority").default("medium").notNull(),
    status: taskStatusEnum("status").default("pending").notNull(),
    recurring: boolean("recurring").default(false).notNull(),
    recurrence: taskRecurrenceEnum("recurrence"),
    recurrenceKey: text("recurrence_key"),
    parentId: uuid("parent_id"),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    ...auditColumns(),
  },
  (table) => [
    check("tasks_title_not_blank", sql`btrim(${table.title}) <> ''`),
    check(
      "tasks_recurrence_consistency",
      sql`(
        (${table.recurring} = true and ${table.recurrence} is not null and ${table.parentId} is null and ${table.recurrenceKey} is null)
        or
        (${table.recurring} = false and ${table.recurrence} is null and ${table.parentId} is null and ${table.recurrenceKey} is null)
        or
        (${table.recurring} = false and ${table.recurrence} is null and ${table.parentId} is not null and ${table.recurrenceKey} is not null and btrim(${table.recurrenceKey}) <> '')
      )`,
    ),
    check(
      "tasks_completion_consistency",
      sql`(
        (${table.status} = 'pending' and ${table.completedAt} is null)
        or
        (${table.status} = 'completed' and ${table.completedAt} is not null)
      )`,
    ),
    foreignKey({
      name: "tasks_owner_id_client_id_clients_owner_id_id_fk",
      columns: [table.ownerId, table.clientId],
      foreignColumns: [clients.ownerId, clients.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "tasks_owner_id_parent_id_tasks_owner_id_id_fk",
      columns: [table.ownerId, table.parentId],
      foreignColumns: [table.ownerId, table.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    unique("tasks_owner_id_id_unique").on(table.ownerId, table.id),
    index("tasks_owner_id_client_id_idx").on(table.ownerId, table.clientId),
    index("tasks_owner_id_parent_id_idx").on(table.ownerId, table.parentId),
    index("tasks_owner_id_status_due_date_idx").on(
      table.ownerId,
      table.status,
      table.dueDate,
    ),
    uniqueIndex("tasks_parent_id_recurrence_key_unique")
      .on(table.parentId, table.recurrenceKey)
      .where(sql`${table.parentId} is not null and ${table.recurrenceKey} is not null`),
    ...authenticatedOwnerPolicies("tasks", table.ownerId, {
      allowDelete: true,
    }),
  ],
).enableRLS();
