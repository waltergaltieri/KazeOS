import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/db/schema";
import { clients, tasks } from "@/db/schema";
import { buildNextMonthlyTask } from "@/lib/domain/task-recurrence";
import type { TaskFormValues } from "@/lib/validations/task";

type TaskDatabase = PostgresJsDatabase<typeof schema>;
type TaskScope = { ownerId: string; taskId: string };

export class TaskNotFoundError extends Error {}
export class TaskStatusTransitionError extends Error {}
export class TaskOccurrenceRecurrenceError extends Error {}

async function assertOwnedClient(database: TaskDatabase, ownerId: string, clientId: string | null) {
  if (clientId === null) return;
  const [client] = await database.select({ id: clients.id }).from(clients)
    .where(and(eq(clients.ownerId, ownerId), eq(clients.id, clientId))).limit(1);
  if (!client) throw new TaskNotFoundError();
}

async function lockTask(database: TaskDatabase, scope: TaskScope) {
  const [task] = await database.select().from(tasks)
    .where(and(eq(tasks.ownerId, scope.ownerId), eq(tasks.id, scope.taskId)))
    .limit(1).for("update");
  if (!task) throw new TaskNotFoundError();
  return task;
}

export async function createTask(database: TaskDatabase, input: { ownerId: string; values: TaskFormValues; now?: Date }) {
  await assertOwnedClient(database, input.ownerId, input.values.clientId);
  const [created] = await database.insert(tasks).values({
    ...input.values,
    ownerId: input.ownerId,
    completedAt: input.values.status === "completed" ? (input.now ?? new Date()) : null,
  }).returning({ id: tasks.id, clientId: tasks.clientId });
  if (!created) throw new Error("Task insert did not return a row");
  return created;
}

export async function updateTask(database: TaskDatabase, input: TaskScope & { values: TaskFormValues }) {
  const current = await lockTask(database, input);
  if (input.values.status !== current.status) throw new TaskStatusTransitionError();
  if (current.parentId !== null && input.values.recurring) throw new TaskOccurrenceRecurrenceError();
  await assertOwnedClient(database, input.ownerId, input.values.clientId);
  const [updated] = await database.update(tasks).set({
    clientId: input.values.clientId,
    title: input.values.title,
    description: input.values.description,
    dueDate: input.values.dueDate,
    priority: input.values.priority,
    recurring: current.parentId === null ? input.values.recurring : false,
    recurrence: current.parentId === null ? input.values.recurrence : null,
    updatedAt: new Date(),
  }).where(and(eq(tasks.ownerId, input.ownerId), eq(tasks.id, input.taskId)))
    .returning({ id: tasks.id, clientId: tasks.clientId });
  if (!updated) throw new TaskNotFoundError();
  return updated;
}

export async function completeTask(database: TaskDatabase, input: TaskScope & { completedAt?: Date }) {
  const current = await lockTask(database, input);
  if (current.status === "completed") return { id: current.id, clientId: current.clientId, createdNext: false, nextTaskId: null };

  const completedAt = input.completedAt ?? new Date();
  const [updated] = await database.update(tasks).set({ status: "completed", completedAt, updatedAt: completedAt })
    .where(and(eq(tasks.ownerId, input.ownerId), eq(tasks.id, input.taskId), eq(tasks.status, "pending")))
    .returning({ id: tasks.id, clientId: tasks.clientId });
  if (!updated) throw new TaskStatusTransitionError();

  let rootId: string | null = null;
  let recurrenceAnchorDate = current.dueDate;
  if (current.recurring && current.recurrence === "monthly" && current.parentId === null) rootId = current.id;
  if (current.parentId !== null) {
    const [root] = await database.select({ id: tasks.id, dueDate: tasks.dueDate }).from(tasks).where(and(
      eq(tasks.ownerId, input.ownerId), eq(tasks.id, current.parentId), eq(tasks.recurring, true), eq(tasks.recurrence, "monthly"),
    )).limit(1).for("update");
    rootId = root?.id ?? null;
    recurrenceAnchorDate = root?.dueDate ?? current.dueDate;
  }

  if (!rootId || current.dueDate === null) return { ...updated, createdNext: false, nextTaskId: null };
  const [next] = await database.insert(tasks).values(buildNextMonthlyTask({
    clientId: current.clientId,
    description: current.description,
    dueDate: current.dueDate,
    ownerId: input.ownerId,
    priority: current.priority,
    recurrenceAnchorDate: recurrenceAnchorDate ?? current.dueDate,
    rootId,
    title: current.title,
  })).onConflictDoNothing().returning({ id: tasks.id });
  return { ...updated, createdNext: Boolean(next), nextTaskId: next?.id ?? null };
}

export async function reopenTask(database: TaskDatabase, input: TaskScope) {
  const current = await lockTask(database, input);
  if (current.status === "pending") return { id: current.id, clientId: current.clientId };
  const [updated] = await database.update(tasks).set({ status: "pending", completedAt: null, updatedAt: new Date() })
    .where(and(eq(tasks.ownerId, input.ownerId), eq(tasks.id, input.taskId), eq(tasks.status, "completed")))
    .returning({ id: tasks.id, clientId: tasks.clientId });
  if (!updated) throw new TaskStatusTransitionError();
  return updated;
}

export async function deleteTask(database: TaskDatabase, input: TaskScope) {
  const [deleted] = await database.delete(tasks)
    .where(and(eq(tasks.ownerId, input.ownerId), eq(tasks.id, input.taskId)))
    .returning({ id: tasks.id, clientId: tasks.clientId });
  if (!deleted) throw new TaskNotFoundError();
  return deleted;
}
