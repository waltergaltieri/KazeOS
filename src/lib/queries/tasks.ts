import "server-only";

import { and, asc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { withAuthenticatedDb } from "@/db";
import * as schema from "@/db/schema";
import { clients, tasks } from "@/db/schema";
import { requireUser } from "@/lib/auth/require-user";
import { validateCommercialDate } from "@/lib/domain/commercial-date";
import { taskFiltersSchema, taskIdSchema, type TaskFilters } from "@/lib/validations/task";

type TaskDatabase = PostgresJsDatabase<typeof schema>;
export interface TaskListItem {
  id: string;
  clientId: string | null;
  clientName: string | null;
  title: string;
  description: string | null;
  dueDate: string | null;
  priority: "low" | "medium" | "high";
  status: "pending" | "completed";
  recurring: boolean;
  recurrence: "monthly" | null;
  parentId: string | null;
  completedAt: Date | null;
  hasOccurrences?: boolean;
}

function conditions(filters: TaskFilters, asOf: string): SQL[] {
  const result: SQL[] = [];
  if (filters.clientId) result.push(eq(tasks.clientId, filters.clientId));
  if (filters.priority) result.push(eq(tasks.priority, filters.priority));
  if (filters.search) {
    const pattern = `%${filters.search.replace(/[\\%_]/g, "\\$&")}%`;
    result.push(or(ilike(tasks.title, pattern), ilike(tasks.description, pattern), ilike(clients.firstName, pattern), ilike(clients.lastName, pattern), ilike(clients.company, pattern))!);
  }
  if (filters.status === "today") result.push(and(eq(tasks.status, "pending"), eq(tasks.dueDate, asOf))!);
  if (filters.status === "upcoming") result.push(and(eq(tasks.status, "pending"), sql`${tasks.dueDate} > ${asOf}`)!);
  if (filters.status === "overdue") result.push(and(eq(tasks.status, "pending"), sql`${tasks.dueDate} < ${asOf}`)!);
  if (filters.status === "completed") result.push(eq(tasks.status, "completed"));
  if (filters.status === "undated") result.push(and(eq(tasks.status, "pending"), isNull(tasks.dueDate))!);
  return result;
}

const selection = {
  id: tasks.id,
  clientId: tasks.clientId,
  clientName: sql<string | null>`case when ${clients.id} is null then null else trim(concat_ws(' ', ${clients.firstName}, ${clients.lastName})) end`,
  title: tasks.title,
  description: tasks.description,
  dueDate: tasks.dueDate,
  priority: tasks.priority,
  status: tasks.status,
  recurring: tasks.recurring,
  recurrence: tasks.recurrence,
  parentId: tasks.parentId,
  completedAt: tasks.completedAt,
  hasOccurrences: sql<boolean>`exists (select 1 from tasks occurrence where occurrence.owner_id = ${tasks.ownerId} and occurrence.parent_id = ${tasks.id})`,
};

export async function queryTasks(database: TaskDatabase, ownerId: string, input: unknown, asOfInput: string): Promise<TaskListItem[]> {
  const filters = taskFiltersSchema.parse(input);
  const asOf = validateCommercialDate(asOfInput);
  return database.select(selection).from(tasks)
    .leftJoin(clients, and(eq(clients.ownerId, tasks.ownerId), eq(clients.id, tasks.clientId)))
    .where(and(eq(tasks.ownerId, ownerId), ...conditions(filters, asOf)))
    .orderBy(
      sql`case when ${tasks.status} = 'pending' then 0 else 1 end`,
      sql`case when ${tasks.status} = 'pending' and ${tasks.dueDate} is not null then 0 when ${tasks.status} = 'pending' then 1 else 2 end`,
      asc(tasks.dueDate),
      sql`case ${tasks.priority} when 'high' then 0 when 'medium' then 1 else 2 end`,
      asc(tasks.id),
    );
}

export async function queryTaskById(database: TaskDatabase, ownerId: string, idInput: unknown): Promise<TaskListItem | null> {
  const id = taskIdSchema.parse(idInput);
  const [task] = await database.select(selection).from(tasks)
    .leftJoin(clients, and(eq(clients.ownerId, tasks.ownerId), eq(clients.id, tasks.clientId)))
    .where(and(eq(tasks.ownerId, ownerId), eq(tasks.id, id))).limit(1);
  return task ?? null;
}

export async function getTasks(input: unknown, asOfInput: string) {
  taskFiltersSchema.parse(input);
  validateCommercialDate(asOfInput);
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) => queryTasks(database, user.id, input, asOfInput));
}

export async function getTaskById(idInput: unknown) {
  const id = taskIdSchema.parse(idInput);
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) => queryTaskById(database, user.id, id));
}

export async function getTaskFilterOptions() {
  const user = await requireUser();
  return withAuthenticatedDb(user.id, (database) => database.select({
    id: clients.id,
    label: sql<string>`trim(concat_ws(' ', ${clients.firstName}, ${clients.lastName})) || case when ${clients.company} is null then '' else ' · ' || ${clients.company} end`,
  }).from(clients).where(eq(clients.ownerId, user.id)).orderBy(asc(sql`lower(${clients.firstName})`), asc(clients.id)));
}
