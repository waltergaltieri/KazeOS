import { describe, expect, it } from "vitest";

import { taskFiltersSchema, taskFormSchema } from "./task";

const validTask = {
  clientId: "11111111-1111-4111-8111-111111111111",
  title: " Preparar informe mensual ",
  description: " Revisar métricas y entregables ",
  dueDate: "2026-08-31",
  priority: "high",
  status: "pending",
  recurring: "on",
  recurrence: "monthly",
};

describe("taskFormSchema", () => {
  it("normalizes optional fields and a monthly recurring task", () => {
    expect(taskFormSchema.parse(validTask)).toEqual({
      clientId: validTask.clientId,
      title: "Preparar informe mensual",
      description: "Revisar métricas y entregables",
      dueDate: "2026-08-31",
      priority: "high",
      status: "pending",
      recurring: true,
      recurrence: "monthly",
    });
  });

  it("accepts a non-recurring task without client, description, or due date", () => {
    expect(taskFormSchema.parse({
      clientId: "",
      title: "Tarea general",
      description: " ",
      dueDate: "",
      priority: "low",
      status: "completed",
      recurring: undefined,
      recurrence: "",
    })).toEqual({
      clientId: null,
      title: "Tarea general",
      description: null,
      dueDate: null,
      priority: "low",
      status: "completed",
      recurring: false,
      recurrence: null,
    });
  });

  it.each([
    { dueDate: "2026-02-30" },
    { dueDate: "31/08/2026" },
    { priority: "urgent" },
    { status: "archived" },
    { clientId: "not-a-uuid" },
  ])("rejects invalid date, priority, status, and client combinations", (patch) => {
    expect(taskFormSchema.safeParse({ ...validTask, ...patch }).success).toBe(false);
  });

  it("requires a due date and monthly recurrence when recurring", () => {
    for (const patch of [
      { dueDate: "" },
      { recurrence: "" },
      { recurrence: "weekly" },
    ]) {
      expect(taskFormSchema.safeParse({ ...validTask, ...patch }).success).toBe(false);
    }
    expect(taskFormSchema.safeParse({ ...validTask, recurring: undefined, recurrence: "monthly" }).success).toBe(false);
  });
});

describe("taskFiltersSchema", () => {
  it("normalizes URL filters and constrains supported views", () => {
    expect(taskFiltersSchema.parse({ status: "today", q: "  informe ", priority: "high", clientId: validTask.clientId })).toEqual({
      status: "today",
      search: "informe",
      priority: "high",
      clientId: validTask.clientId,
    });
    expect(taskFiltersSchema.safeParse({ status: "tomorrow" }).success).toBe(false);
  });
});
