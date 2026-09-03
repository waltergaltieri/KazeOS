import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getExpenseFormOptions: vi.fn(),
  getRecurringExpenseById: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/queries/expenses", () => ({
  getExpenseFormOptions: mocks.getExpenseFormOptions,
  getRecurringExpenseById: mocks.getRecurringExpenseById,
}));
vi.mock("@/lib/actions/recurring-expenses", () => ({ updateRecurringExpenseAction: vi.fn() }));
vi.mock("@/components/expenses/expense-form", () => ({
  ExpenseForm: ({ defaults, forceRecurring, mode }: { defaults: Record<string, unknown>; forceRecurring: boolean; mode: string }) => (
    <output aria-label="Formulario recurrente">{JSON.stringify({ defaults, forceRecurring, mode })}</output>
  ),
}));

import EditRecurringExpensePage from "./page";

const recurringExpenseId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const category = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Servicios", icon: null, active: false };
const recurringExpense = {
  id: recurringExpenseId,
  title: "Internet",
  description: null,
  amountMinor: 45_000_00,
  currency: "ARS",
  category,
  scope: "business",
  costType: "fixed",
  frequency: "monthly",
  billingDay: 10,
  startDate: "2026-09-01",
  endDate: null,
  status: "active",
  paymentMethod: "bank_transfer",
  vendor: null,
  notes: null,
  automaticGeneration: true,
};

describe("EditRecurringExpensePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getExpenseFormOptions.mockResolvedValue({ categories: [category], recurringExpenses: [] });
  });

  it("maps the first due date and retains the inactive historical category", async () => {
    mocks.getRecurringExpenseById.mockResolvedValue(recurringExpense);
    render(await EditRecurringExpensePage({ params: Promise.resolve({ id: recurringExpenseId }) }));

    expect(mocks.getExpenseFormOptions).toHaveBeenCalledWith({ includeInactive: true });
    const output = JSON.parse(screen.getByLabelText("Formulario recurrente").textContent!);
    expect(output).toMatchObject({
      forceRecurring: true,
      mode: "recurring-edit",
      defaults: {
        recurringExpenseId,
        categoryId: category.id,
        dueDate: "2026-09-10",
        billingDay: 10,
      },
    });
  });

  it.each([null, { ...recurringExpense, status: "cancelled" }])(
    "returns not found for absent or cancelled template %#",
    async (template) => {
      mocks.getRecurringExpenseById.mockResolvedValue(template);
      await expect(EditRecurringExpensePage({ params: Promise.resolve({ id: recurringExpenseId }) }))
        .rejects.toThrow("NEXT_NOT_FOUND");
      expect(mocks.notFound).toHaveBeenCalledOnce();
    },
  );
});
