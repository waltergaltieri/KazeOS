import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getExpenseById: vi.fn(),
  getExpenseFormOptions: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/queries/expenses", () => ({
  getExpenseById: mocks.getExpenseById,
  getExpenseFormOptions: mocks.getExpenseFormOptions,
}));
vi.mock("@/lib/actions/expenses", () => ({ updateExpenseAction: vi.fn() }));
vi.mock("@/components/expenses/expense-form", () => ({
  ExpenseForm: ({ defaults, mode }: { defaults: Record<string, unknown>; mode: string }) => (
    <output aria-label="Formulario de edición">{JSON.stringify({ defaults, mode })}</output>
  ),
}));

import EditExpensePage from "./page";

const expenseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const category = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Servicios", icon: null, active: true };
const editableExpense = {
  id: expenseId,
  title: "Internet",
  description: null,
  amountMinor: 45_000_00,
  currency: "ARS",
  category,
  scope: "business",
  costType: "fixed",
  dueDate: "2026-09-15",
  paidDate: null,
  persistedStatus: "pending",
  paymentMethod: null,
  vendor: null,
  notes: null,
  generatedAutomatically: false,
  recurringExpense: null,
};

describe("EditExpensePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getExpenseFormOptions.mockResolvedValue({ categories: [category], recurringExpenses: [] });
  });

  it("loads inactive-capable options and maps an editable manual expense", async () => {
    mocks.getExpenseById.mockResolvedValue(editableExpense);
    render(await EditExpensePage({ params: Promise.resolve({ id: expenseId }) }));

    expect(mocks.getExpenseFormOptions).toHaveBeenCalledWith({ includeInactive: true });
    const output = JSON.parse(screen.getByLabelText("Formulario de edición").textContent!);
    expect(output).toMatchObject({
      mode: "edit",
      defaults: { id: expenseId, categoryId: category.id, status: "pending" },
    });
  });

  it.each([
    null,
    { ...editableExpense, generatedAutomatically: true },
    { ...editableExpense, recurringExpense: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } },
    { ...editableExpense, persistedStatus: "paid", paidDate: "2026-09-16" },
  ])("returns not found for absent or history-locked expense %#", async (expense) => {
    mocks.getExpenseById.mockResolvedValue(expense);
    await expect(EditExpensePage({ params: Promise.resolve({ id: expenseId }) }))
      .rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("returns not found for an invalid id before querying expense data", async () => {
    await expect(EditExpensePage({ params: Promise.resolve({ id: "not-a-uuid" }) }))
      .rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.getExpenseById).not.toHaveBeenCalled();
    expect(mocks.getExpenseFormOptions).not.toHaveBeenCalled();
  });
});
