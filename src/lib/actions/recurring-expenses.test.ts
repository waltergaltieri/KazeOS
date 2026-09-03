import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelRecurringExpense: vi.fn(),
  createRecurringExpenseWithOccurrences: vi.fn(),
  pauseRecurringExpense: vi.fn(),
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  updateRecurringExpenseWithOccurrences: vi.fn(),
  withAuthenticatedDb: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/services/recurring-expense-manager", () => ({
  cancelRecurringExpense: mocks.cancelRecurringExpense,
  createRecurringExpenseWithOccurrences:
    mocks.createRecurringExpenseWithOccurrences,
  pauseRecurringExpense: mocks.pauseRecurringExpense,
  updateRecurringExpenseWithOccurrences:
    mocks.updateRecurringExpenseWithOccurrences,
}));

import {
  cancelRecurringExpenseAction,
  createRecurringExpenseAction,
  pauseRecurringExpenseAction,
  updateRecurringExpenseAction,
} from "./recurring-expenses";
import { ExpenseCategoryInactiveError } from "@/lib/services/expense-category-manager";
import { buildRecurringPeriods } from "@/lib/domain/recurrence";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const categoryId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const recurringExpenseId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function recurringFormData() {
  const data = new FormData();
  data.set("title", " Vercel ");
  data.set("description", " Hosting ");
  data.set("amount", "20,00");
  data.set("currency", "USD");
  data.set("categoryId", categoryId);
  data.set("scope", "business");
  data.set("costType", "fixed");
  data.set("dueDate", "2026-09-10");
  data.set("paidDate", "");
  data.set("status", "pending");
  data.set("paymentMethod", "credit_card");
  data.set("vendor", " Vercel Inc. ");
  data.set("notes", " Renovación ");
  data.set("recurring", "on");
  data.set("frequency", "monthly");
  data.set("billingDay", "31");
  data.set("startDate", "2026-09-10");
  data.set("endDate", "");
  data.set("automaticGeneration", "on");
  return data;
}

describe("recurring expense actions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-02T15:00:00Z"));
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: ownerId });
    mocks.withAuthenticatedDb.mockImplementation(
      (_ownerId: string, operation: (database: object) => unknown) =>
        operation({}),
    );
    mocks.createRecurringExpenseWithOccurrences.mockResolvedValue({
      id: recurringExpenseId,
    });
    mocks.updateRecurringExpenseWithOccurrences.mockResolvedValue({
      id: recurringExpenseId,
    });
    mocks.pauseRecurringExpense.mockResolvedValue({ id: recurringExpenseId });
    mocks.cancelRecurringExpense.mockResolvedValue({ id: recurringExpenseId });
  });

  afterEach(() => vi.useRealTimers());

  it("creates a recurring template with the verified owner and normalized values", async () => {
    const result = await createRecurringExpenseAction(
      { status: "idle" },
      recurringFormData(),
    );

    expect(result).toEqual({ status: "success", recurringExpenseId });
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledWith(
      ownerId,
      expect.any(Function),
    );
    expect(mocks.createRecurringExpenseWithOccurrences).toHaveBeenCalledWith(
      expect.anything(),
      {
        asOf: "2026-09-02",
        ownerId,
        values: {
          amountMinor: 2_000,
          automaticGeneration: true,
          billingDay: 10,
          categoryId,
          costType: "fixed",
          currency: "USD",
          description: "Hosting",
          endDate: null,
          frequency: "monthly",
          notes: "Renovación",
          paymentMethod: "credit_card",
          scope: "business",
          startDate: "2026-09-10",
          title: "Vercel",
          vendor: "Vercel Inc.",
        },
      },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/expenses");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("rejects one-off or invalid form data before opening the database", async () => {
    const data = recurringFormData();
    data.set("recurring", "off");

    const result = await createRecurringExpenseAction(
      { status: "idle" },
      data,
    );

    expect(result.status).toBe("error");
    expect(mocks.withAuthenticatedDb).not.toHaveBeenCalled();
  });

  it("rejects paid state for recurring templates before opening the database", async () => {
    const data = recurringFormData();
    data.set("status", "paid");
    data.set("paidDate", "2026-09-10");

    const result = await createRecurringExpenseAction({ status: "idle" }, data);

    expect(result).toMatchObject({
      fieldErrors: { status: expect.any(Array) },
      status: "error",
    });
    expect(mocks.withAuthenticatedDb).not.toHaveBeenCalled();
  });

  it("maps an unavailable category to the category field", async () => {
    mocks.createRecurringExpenseWithOccurrences.mockRejectedValue(
      new ExpenseCategoryInactiveError(),
    );

    const result = await createRecurringExpenseAction(
      { status: "idle" },
      recurringFormData(),
    );

    expect(result).toEqual({
      fieldErrors: {
        categoryId: ["Elegí una categoría activa de tu cuenta."],
      },
      message: "La categoría no está disponible.",
      status: "error",
    });
  });

  it("updates an owned template and returns its id", async () => {
    const data = recurringFormData();
    data.set("recurringExpenseId", recurringExpenseId);

    const result = await updateRecurringExpenseAction(
      { status: "idle" },
      data,
    );

    expect(result).toEqual({ status: "success", recurringExpenseId });
    expect(mocks.updateRecurringExpenseWithOccurrences).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ownerId, recurringExpenseId }),
    );
  });

  it("keeps the original day-31 anchor when editing through a February occurrence", async () => {
    const data = recurringFormData();
    data.set("recurringExpenseId", recurringExpenseId);
    data.set("dueDate", "2026-02-28");
    data.set("startDate", "2026-01-31");
    data.set("billingDay", "31");

    await updateRecurringExpenseAction({ status: "idle" }, data);

    const values = mocks.updateRecurringExpenseWithOccurrences.mock.calls[0]![1].values;
    expect(values).toMatchObject({ startDate: "2026-01-31", billingDay: 31 });
    expect(buildRecurringPeriods({ ...values, label: values.title }, "2026-03-01", 2).map(({ dueDate }) => dueDate))
      .toEqual(["2026-03-31", "2026-04-30"]);
  });

  it.each([
    [pauseRecurringExpenseAction, mocks.pauseRecurringExpense],
    [cancelRecurringExpenseAction, mocks.cancelRecurringExpense],
  ] as const)("runs lifecycle action %# without accepting status from the form", async (action, manager) => {
    const data = new FormData();
    data.set("recurringExpenseId", recurringExpenseId);
    data.set("status", "active");

    const result = await action({ status: "idle" }, data);

    expect(result).toEqual({ status: "success", recurringExpenseId });
    expect(manager).toHaveBeenCalledWith(expect.anything(), {
      asOf: "2026-09-02",
      ownerId,
      recurringExpenseId,
    });
  });

  it("exports lifecycle server actions as native async functions", () => {
    expect(pauseRecurringExpenseAction.constructor.name).toBe("AsyncFunction");
    expect(cancelRecurringExpenseAction.constructor.name).toBe("AsyncFunction");
  });
});
