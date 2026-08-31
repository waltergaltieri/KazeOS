import { describe, expect, it } from "vitest";

import { buildNextMonthlyTask } from "./task-recurrence";

const task = {
  clientId: "11111111-1111-4111-8111-111111111111",
  description: "Informe y seguimiento",
  dueDate: "2027-01-31",
  ownerId: "22222222-2222-4222-8222-222222222222",
  priority: "high" as const,
  rootId: "33333333-3333-4333-8333-333333333333",
  title: "Enviar informe mensual",
};

describe("buildNextMonthlyTask", () => {
  it("creates one non-recurring child and clamps month-end dates", () => {
    expect(buildNextMonthlyTask(task)).toEqual({
      clientId: task.clientId,
      description: task.description,
      dueDate: "2027-02-28",
      ownerId: task.ownerId,
      parentId: task.rootId,
      priority: "high",
      recurrence: null,
      recurrenceKey: "2027-02-28",
      recurring: false,
      status: "pending",
      title: task.title,
    });
  });

  it("uses the commercial due date as an idempotency key", () => {
    const first = buildNextMonthlyTask({ ...task, dueDate: "2028-01-31" });
    const retry = buildNextMonthlyTask({ ...task, dueDate: "2028-01-31" });

    expect(first.dueDate).toBe("2028-02-29");
    expect(retry.recurrenceKey).toBe(first.recurrenceKey);
    expect(retry.parentId).toBe(task.rootId);
  });

  it("returns to the series anchor day after a short month", () => {
    const march = buildNextMonthlyTask({
      ...task,
      dueDate: "2027-02-28",
      recurrenceAnchorDate: "2027-01-31",
    });

    expect(march.dueDate).toBe("2027-03-31");
    expect(march.recurrenceKey).toBe("2027-03-31");
  });
});
