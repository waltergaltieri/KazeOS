import { describe, expect, it } from "vitest";

import { getExpenseStatus } from "./expense-status";

describe("getExpenseStatus", () => {
  it.each([
    ["planned", "2026-09-20", "planned"],
    ["pending", "2026-09-20", "pending"],
    ["planned", "2026-09-09", "overdue"],
    ["paid", "2026-09-01", "paid"],
    ["cancelled", "2026-09-01", "cancelled"],
  ] as const)(
    "derives %s due on %s as %s",
    (status, dueDate, expected) => {
      expect(
        getExpenseStatus({ status, dueDate }, "2026-09-10"),
      ).toBe(expected);
    },
  );
});
