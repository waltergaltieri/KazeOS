import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getExpenseById: vi.fn(),
  getExpenseFormOptions: vi.fn(),
  getPrimaryCurrency: vi.fn(),
}));

vi.mock("@/lib/queries/expenses", () => ({
  getExpenseById: mocks.getExpenseById,
  getExpenseFormOptions: mocks.getExpenseFormOptions,
}));
vi.mock("@/lib/queries/settings", () => ({ getPrimaryCurrency: mocks.getPrimaryCurrency }));
vi.mock("@/lib/actions/expenses", () => ({ createExpenseAction: vi.fn() }));
vi.mock("@/lib/actions/recurring-expenses", () => ({ createRecurringExpenseAction: vi.fn() }));
vi.mock("@/components/expenses/expense-form", () => ({
  ExpenseForm: ({ defaults, defaultCurrency }: { defaults?: Record<string, unknown>; defaultCurrency: string }) => (
    <output aria-label="Configuración del formulario">
      {JSON.stringify({ defaults, defaultCurrency })}
    </output>
  ),
}));

import NewExpensePage from "./page";

const categoryId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const expenseId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("NewExpensePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrimaryCurrency.mockResolvedValue("ARS");
    mocks.getExpenseFormOptions.mockResolvedValue({
      categories: [{ id: categoryId, name: "Servicios", icon: null, active: true }],
      recurringExpenses: [],
    });
  });

  it("loads active creation options and the owner's primary currency", async () => {
    render(await NewExpensePage({ searchParams: Promise.resolve({}) }));

    expect(mocks.getExpenseFormOptions).toHaveBeenCalledWith();
    expect(mocks.getExpenseById).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Configuración del formulario")).toHaveTextContent('"defaultCurrency":"ARS"');
  });

  it("ignores a malformed duplicate reference before querying the ledger", async () => {
    render(await NewExpensePage({ searchParams: Promise.resolve({ duplicate: "not-an-id" }) }));

    expect(mocks.getExpenseById).not.toHaveBeenCalled();
    const configuration = JSON.parse(screen.getByLabelText("Configuración del formulario").textContent!);
    expect(configuration.defaults).toBeUndefined();
  });

  it("prefills duplicate-safe values without identity, recurrence, generated or paid metadata", async () => {
    mocks.getExpenseById.mockResolvedValue({
      id: expenseId,
      title: "Vercel",
      description: "Hosting",
      amountMinor: 2_000,
      currency: "USD",
      categoryId,
      category: { id: categoryId, name: "Servicios", icon: null, active: true },
      scope: "business",
      costType: "fixed",
      dueDate: "2026-09-10",
      paidDate: "2026-09-11",
      status: "paid",
      persistedStatus: "paid",
      paymentMethod: "credit_card",
      vendor: "Vercel",
      notes: "Original",
      recurringExpense: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
      recurringExpenseId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      periodKey: "2026-09",
      generatedAutomatically: true,
    });

    render(await NewExpensePage({ searchParams: Promise.resolve({ duplicate: expenseId }) }));

    expect(mocks.getExpenseById).toHaveBeenCalledWith(expenseId, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    const configuration = JSON.parse(screen.getByLabelText("Configuración del formulario").textContent!);
    expect(configuration.defaults).toMatchObject({
      title: "Vercel — copia",
      description: "Hosting",
      amountMinor: 2_000,
      currency: "USD",
      categoryId,
      scope: "business",
      costType: "fixed",
      dueDate: "2026-09-10",
      status: "pending",
      vendor: "Vercel",
      notes: "Original",
    });
    expect(configuration.defaults).not.toHaveProperty("id");
    expect(configuration.defaults).not.toHaveProperty("recurringExpenseId");
    expect(configuration.defaults).not.toHaveProperty("periodKey");
    expect(configuration.defaults).not.toHaveProperty("generatedAutomatically");
    expect(configuration.defaults).not.toHaveProperty("paidDate");
    expect(configuration.defaults).not.toHaveProperty("paymentMethod");
  });
});
