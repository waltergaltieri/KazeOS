"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";

import { withAuthenticatedDb } from "@/db";
import { requireUser } from "@/lib/auth/require-user";
import {
  completeTask,
  createTask,
  deleteTask,
  deleteTaskSeries,
  reopenTask,
  TaskOccurrenceRecurrenceError,
  TaskStatusTransitionError,
  updateTask,
} from "@/lib/services/task-manager";
import { taskFormSchema, taskIdSchema } from "@/lib/validations/task";

export interface TaskActionState {
  status: "idle" | "error" | "success";
  message?: string;
  taskId?: string;
  clientId?: string | null;
  createdNext?: boolean;
  fieldErrors?: Record<string, string[]>;
}

function valuesFromFormData(formData: FormData) {
  return {
    clientId: formData.get("clientId"),
    title: formData.get("title"),
    description: formData.get("description"),
    dueDate: formData.get("dueDate"),
    priority: formData.get("priority"),
    status: formData.get("status") || undefined,
    recurring: formData.get("recurring"),
    recurrence: formData.get("recurrence"),
  };
}

function invalid(error: ZodError): TaskActionState {
  return {
    status: "error",
    message: "Revisá los campos indicados.",
    fieldErrors: error.flatten().fieldErrors,
  };
}

function revalidateTaskPaths(clientId: string | null, taskId?: string) {
  revalidatePath("/tasks");
  revalidatePath("/dashboard");
  if (clientId) {
    revalidatePath(`/clients/${clientId}`);
    revalidatePath(`/clients/${clientId}/tasks`);
  }
  if (taskId) revalidatePath(`/tasks/${taskId}/edit`);
}

function safeError(error: unknown): TaskActionState {
  if (error instanceof TaskStatusTransitionError) {
    return { status: "error", message: "Usá la casilla de la agenda para completar o reabrir la tarea." };
  }
  if (error instanceof TaskOccurrenceRecurrenceError) {
    return { status: "error", message: "Las ocurrencias generadas continúan la serie original y no pueden iniciar otra recurrencia." };
  }
  return { status: "error", message: "No pudimos guardar el cambio. Volvé a intentarlo." };
}

export async function createTaskAction(_state: TaskActionState, formData: FormData): Promise<TaskActionState> {
  const parsed = taskFormSchema.safeParse(valuesFromFormData(formData));
  if (!parsed.success) return invalid(parsed.error);
  const user = await requireUser();
  try {
    const created = await withAuthenticatedDb(user.id, (database) => createTask(database, { ownerId: user.id, values: { ...parsed.data, status: "pending" } }));
    revalidateTaskPaths(created.clientId, created.id);
    return { status: "success", taskId: created.id, clientId: created.clientId };
  } catch (error) {
    return safeError(error);
  }
}

export async function updateTaskAction(_state: TaskActionState, formData: FormData): Promise<TaskActionState> {
  const id = taskIdSchema.safeParse(formData.get("taskId"));
  const parsed = taskFormSchema.safeParse(valuesFromFormData(formData));
  if (!id.success || !parsed.success) {
    return !parsed.success ? invalid(parsed.error) : { status: "error", message: "La tarea no es válida." };
  }
  const user = await requireUser();
  try {
    const updated = await withAuthenticatedDb(user.id, (database) => updateTask(database, { ownerId: user.id, taskId: id.data, values: parsed.data }));
    revalidateTaskPaths(updated.clientId, updated.id);
    return { status: "success", taskId: updated.id, clientId: updated.clientId };
  } catch (error) {
    return safeError(error);
  }
}

async function runCommand(
  formData: FormData,
  operation: (ownerId: string, taskId: string) => Promise<{ id: string; clientId: string | null; createdNext?: boolean }>,
): Promise<TaskActionState> {
  const id = taskIdSchema.safeParse(formData.get("taskId"));
  if (!id.success) return { status: "error", message: "La tarea no es válida." };
  const user = await requireUser();
  try {
    const result = await operation(user.id, id.data);
    revalidateTaskPaths(result.clientId, result.id);
    return { status: "success", taskId: result.id, clientId: result.clientId, createdNext: result.createdNext };
  } catch (error) {
    return safeError(error);
  }
}

export async function completeTaskAction(_state: TaskActionState, formData: FormData) {
  return runCommand(formData, (ownerId, taskId) => withAuthenticatedDb(ownerId, (database) => completeTask(database, { ownerId, taskId, completedAt: new Date() })));
}

export async function reopenTaskAction(_state: TaskActionState, formData: FormData) {
  return runCommand(formData, (ownerId, taskId) => withAuthenticatedDb(ownerId, (database) => reopenTask(database, { ownerId, taskId })));
}

export async function deleteTaskAction(_state: TaskActionState, formData: FormData) {
  const scope = formData.get("deleteScope");
  if (scope !== "single" && scope !== "series") return { status: "error", message: "El alcance de eliminación no es válido." } satisfies TaskActionState;
  return runCommand(formData, (ownerId, taskId) => withAuthenticatedDb(ownerId, (database) => scope === "series" ? deleteTaskSeries(database, { ownerId, taskId }) : deleteTask(database, { ownerId, taskId })));
}
