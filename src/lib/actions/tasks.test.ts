import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  withAuthenticatedDb: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  reopenTask: vi.fn(),
  deleteTask: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/services/task-manager", () => ({
  createTask: mocks.createTask,
  updateTask: mocks.updateTask,
  completeTask: mocks.completeTask,
  reopenTask: mocks.reopenTask,
  deleteTask: mocks.deleteTask,
  TaskNotFoundError: class extends Error {},
  TaskStatusTransitionError: class extends Error {},
  TaskOccurrenceRecurrenceError: class extends Error {},
}));

import {
  completeTaskAction,
  createTaskAction,
  deleteTaskAction,
  reopenTaskAction,
  updateTaskAction,
} from "./tasks";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const taskId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const clientId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function taskForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  Object.entries({ clientId, title: "Preparar informe", description: "Cierre mensual", dueDate: "2026-09-30", priority: "high", status: "pending", recurring: "on", recurrence: "monthly", ...overrides }).forEach(([key, value]) => form.set(key, value));
  return form;
}

describe("task actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: ownerId });
    mocks.withAuthenticatedDb.mockImplementation((_id: string, operation: (db: object) => unknown) => operation({}));
    mocks.createTask.mockResolvedValue({ id: taskId, clientId });
    mocks.updateTask.mockResolvedValue({ id: taskId, clientId });
    mocks.completeTask.mockResolvedValue({ id: taskId, clientId, createdNext: true });
    mocks.reopenTask.mockResolvedValue({ id: taskId, clientId });
    mocks.deleteTask.mockResolvedValue({ id: taskId, clientId });
  });

  it("creates a normalized task only in the verified owner scope", async () => {
    const result = await createTaskAction({ status: "idle" }, taskForm());
    expect(result).toMatchObject({ status: "success", taskId, clientId });
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledWith(ownerId, expect.any(Function));
    expect(mocks.createTask).toHaveBeenCalledWith(expect.anything(), {
      ownerId,
      values: expect.objectContaining({ clientId, title: "Preparar informe", recurring: true, recurrence: "monthly" }),
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/clients/${clientId}/tasks`);
  });

  it("rejects invalid input before opening a database transaction", async () => {
    const result = await createTaskAction({ status: "idle" }, taskForm({ title: "", dueDate: "31/09/2026" }));
    expect(result.status).toBe("error");
    expect(result.fieldErrors).toMatchObject({ title: expect.any(Array), dueDate: expect.any(Array) });
    expect(mocks.withAuthenticatedDb).not.toHaveBeenCalled();
  });

  it("updates content without smuggling a status transition", async () => {
    const form = taskForm({ taskId, recurring: "", recurrence: "" });
    const result = await updateTaskAction({ status: "idle" }, form);
    expect(result.status).toBe("success");
    expect(mocks.updateTask).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ownerId, taskId, values: expect.objectContaining({ status: "pending" }) }));
  });

  it("completes and reopens through explicit transactional commands", async () => {
    const command = new FormData();
    command.set("taskId", taskId);
    command.set("clientId", clientId);

    await expect(completeTaskAction({ status: "idle" }, command)).resolves.toMatchObject({ status: "success", createdNext: true });
    expect(mocks.completeTask).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ ownerId, taskId, completedAt: expect.any(Date) }));

    await expect(reopenTaskAction({ status: "idle" }, command)).resolves.toMatchObject({ status: "success" });
    expect(mocks.reopenTask).toHaveBeenCalledWith(expect.anything(), { ownerId, taskId });
  });

  it("deletes only after receiving an exact validated task id", async () => {
    const invalid = new FormData();
    invalid.set("taskId", "not-an-id");
    expect((await deleteTaskAction({ status: "idle" }, invalid)).status).toBe("error");
    expect(mocks.deleteTask).not.toHaveBeenCalled();

    const valid = new FormData();
    valid.set("taskId", taskId);
    valid.set("clientId", clientId);
    expect((await deleteTaskAction({ status: "idle" }, valid)).status).toBe("success");
    expect(mocks.deleteTask).toHaveBeenCalledWith(expect.anything(), { ownerId, taskId });
  });
});
