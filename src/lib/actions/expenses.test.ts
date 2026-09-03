import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelExpense: vi.fn(),
  correctPaidExpense: vi.fn(),
  createManualExpense: vi.fn(),
  deleteManualExpense: vi.fn(),
  markExpensePaid: vi.fn(),
  requireUser: vi.fn(),
  revalidatePath: vi.fn(),
  updateManualExpense: vi.fn(),
  withAuthenticatedDb: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/db", () => ({ withAuthenticatedDb: mocks.withAuthenticatedDb }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/services/expense-manager", () => ({
  cancelExpense: mocks.cancelExpense,
  correctPaidExpense: mocks.correctPaidExpense,
  createManualExpense: mocks.createManualExpense,
  deleteManualExpense: mocks.deleteManualExpense,
  markExpensePaid: mocks.markExpensePaid,
  updateManualExpense: mocks.updateManualExpense,
  ExpenseCancellationRestrictedError: class extends Error {},
  ExpenseCategoryUnavailableError: class extends Error {},
  ExpenseDeleteRestrictedError: class extends Error {},
  ExpenseEditLockedError: class extends Error {},
  ExpenseNotFoundError: class extends Error {},
  ExpensePaymentStateError: class extends Error {},
}));

import {
  cancelExpenseAction,
  correctPaidExpenseAction,
  createExpenseAction,
  deleteExpenseAction,
  markExpensePaidAction,
  updateExpenseAction,
} from "./expenses";
import {
  ExpenseCategoryUnavailableError,
  ExpenseCancellationRestrictedError,
  ExpenseDeleteRestrictedError,
  ExpenseEditLockedError,
  ExpenseNotFoundError,
  ExpensePaymentStateError,
} from "@/lib/services/expense-manager";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const expenseId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const categoryId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function expenseForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  Object.entries({
    amount: "1.250,50",
    categoryId,
    costType: "variable",
    currency: "ARS",
    description: " Compra de insumos ",
    dueDate: "2026-09-20",
    notes: " Factura pendiente ",
    paidDate: "",
    paymentMethod: "",
    recurring: "",
    scope: "business",
    status: "pending",
    title: " Insumos ",
    vendor: " Proveedor ",
    ...overrides,
  }).forEach(([key, value]) => {
    if (key !== "recurring" || value !== "") form.set(key, value);
  });
  return form;
}

function paymentForm(overrides: Record<string, string> = {}) {
  const form = new FormData();
  Object.entries({
    amount: "1.375,50",
    expenseId,
    paidDate: "2026-09-21",
    paymentMethod: "credit_card",
    ...overrides,
  }).forEach(([key, value]) => form.set(key, value));
  return form;
}

describe("expense actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: ownerId });
    mocks.withAuthenticatedDb.mockImplementation(
      (_ownerId: string, operation: (database: object) => unknown) => operation({}),
    );
    for (const operation of [
      mocks.cancelExpense,
      mocks.correctPaidExpense,
      mocks.createManualExpense,
      mocks.deleteManualExpense,
      mocks.markExpensePaid,
      mocks.updateManualExpense,
    ]) {
      operation.mockResolvedValue({ id: expenseId });
    }
  });

  it("authenticates, validates and creates a manual expense", async () => {
    const result = await createExpenseAction({ status: "idle" }, expenseForm());

    expect(result).toEqual({ status: "success", expenseId });
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledWith(ownerId, expect.any(Function));
    expect(mocks.createManualExpense).toHaveBeenCalledWith(expect.anything(), {
      ownerId,
      values: expect.objectContaining({
        amountMinor: 125_050,
        recurring: false,
        title: "Insumos",
      }),
    });
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/expenses"],
      ["/dashboard"],
    ]);
  });

  it("creates a paid expense as pending and marks it paid in the same authenticated transaction", async () => {
    const result = await createExpenseAction(
      { status: "idle" },
      expenseForm({
        status: "paid",
        paidDate: "2026-09-21",
        paymentMethod: "credit_card",
      }),
    );

    expect(result).toEqual({ status: "success", expenseId });
    expect(mocks.withAuthenticatedDb).toHaveBeenCalledOnce();
    expect(mocks.createManualExpense).toHaveBeenCalledWith(expect.anything(), {
      ownerId,
      values: expect.objectContaining({
        amountMinor: 125_050,
        paidDate: null,
        recurring: false,
        status: "pending",
      }),
    });
    expect(mocks.markExpensePaid).toHaveBeenCalledWith(expect.anything(), {
      expenseId,
      ownerId,
      values: {
        amountMinor: 125_050,
        expenseId,
        paidDate: "2026-09-21",
        paymentMethod: "credit_card",
      },
    });
    expect(mocks.createManualExpense.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.markExpensePaid.mock.invocationCallOrder[0]!,
    );
  });

  it("authenticates before returning structured validation errors", async () => {
    const result = await createExpenseAction(
      { status: "idle" },
      expenseForm({ amount: "0", title: "" }),
    );

    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      fieldErrors: { amount: expect.any(Array), title: expect.any(Array) },
      status: "error",
    });
    expect(mocks.withAuthenticatedDb).not.toHaveBeenCalled();
  });

  it("updates only through the verified owner transaction", async () => {
    const result = await updateExpenseAction(
      { status: "idle" },
      expenseForm({ expenseId, status: "planned" }),
    );

    expect(result).toEqual({ status: "success", expenseId });
    expect(mocks.updateManualExpense).toHaveBeenCalledWith(expect.anything(), {
      expenseId,
      ownerId,
      values: expect.objectContaining({ status: "planned" }),
    });
  });

  it("marks paid and corrects paid details through distinct validated actions", async () => {
    await expect(markExpensePaidAction({ status: "idle" }, paymentForm()))
      .resolves.toEqual({ status: "success", expenseId });
    expect(mocks.markExpensePaid).toHaveBeenCalledWith(expect.anything(), {
      expenseId,
      ownerId,
      values: expect.objectContaining({
        amountMinor: 137_550,
        paidDate: "2026-09-21",
        paymentMethod: "credit_card",
      }),
    });

    await expect(correctPaidExpenseAction({ status: "idle" }, paymentForm({ amount: "1.400,00" })))
      .resolves.toEqual({ status: "success", expenseId });
    expect(mocks.correctPaidExpense).toHaveBeenCalledWith(expect.anything(), {
      expenseId,
      ownerId,
      values: expect.objectContaining({ amountMinor: 140_000 }),
    });
  });

  it("cancels and deletes only exact validated expense ids", async () => {
    const invalid = new FormData();
    invalid.set("expenseId", "not-an-id");
    expect((await deleteExpenseAction({ status: "idle" }, invalid)).status).toBe("error");
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.deleteManualExpense).not.toHaveBeenCalled();

    const valid = new FormData();
    valid.set("expenseId", expenseId);
    await expect(cancelExpenseAction({ status: "idle" }, valid))
      .resolves.toEqual({ status: "success", expenseId });
    await expect(deleteExpenseAction({ status: "idle" }, valid))
      .resolves.toEqual({ status: "success", expenseId });
    expect(mocks.cancelExpense).toHaveBeenCalledWith(expect.anything(), { expenseId, ownerId });
    expect(mocks.deleteManualExpense).toHaveBeenCalledWith(expect.anything(), { expenseId, ownerId });
  });

  it.each([
    [new ExpenseCategoryUnavailableError(), "La categoría no está disponible para este gasto."],
    [new ExpenseCancellationRestrictedError(), "Solo se pueden cancelar gastos planificados o pendientes."],
    [new ExpenseEditLockedError(), "Solo se pueden editar gastos manuales planificados o pendientes."],
    [new ExpensePaymentStateError(), "El estado actual del gasto no permite registrar ese pago."],
    [new ExpenseDeleteRestrictedError(), "Solo se pueden eliminar gastos manuales planificados o pendientes."],
    [new ExpenseNotFoundError(), "El gasto no existe o no te pertenece."],
  ])("maps known domain errors to safe Spanish feedback", async (error, message) => {
    mocks.updateManualExpense.mockRejectedValue(error);
    const result = await updateExpenseAction(
      { status: "idle" },
      expenseForm({ expenseId }),
    );
    expect(result).toMatchObject({ message, status: "error" });
  });
});
