"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";

import { withAuthenticatedDb } from "@/db";
import { requireUser } from "@/lib/auth/require-user";
import {
  cancelExpense,
  correctPaidExpense,
  createManualExpense,
  deleteManualExpense,
  ExpenseCancellationRestrictedError,
  ExpenseCategoryUnavailableError,
  ExpenseDeleteRestrictedError,
  ExpenseEditLockedError,
  ExpenseNotFoundError,
  ExpensePaymentStateError,
  markExpensePaid,
  updateManualExpense,
} from "@/lib/services/expense-manager";
import {
  expenseCorrectionSchema,
  expenseFormSchema,
  expenseIdSchema,
  expenseMarkPaidSchema,
} from "@/lib/validations/expense";

export interface ExpenseActionState {
  status: "idle" | "error" | "success";
  message?: string;
  expenseId?: string;
  fieldErrors?: Record<string, string[]>;
}

function expenseValuesFromFormData(formData: FormData) {
  return {
    amount: formData.get("amount"),
    automaticGeneration: formData.get("automaticGeneration"),
    billingDay: formData.get("billingDay"),
    categoryId: formData.get("categoryId"),
    costType: formData.get("costType"),
    currency: formData.get("currency"),
    description: formData.get("description"),
    dueDate: formData.get("dueDate"),
    endDate: formData.get("endDate"),
    frequency: formData.get("frequency"),
    notes: formData.get("notes"),
    paidDate: formData.get("paidDate"),
    paymentMethod: formData.get("paymentMethod"),
    recurring: formData.get("recurring"),
    scope: formData.get("scope"),
    startDate: formData.get("startDate"),
    status: formData.get("status") || undefined,
    title: formData.get("title"),
    vendor: formData.get("vendor"),
  };
}

function paymentValuesFromFormData(formData: FormData) {
  return {
    amount: formData.get("amount"),
    expenseId: formData.get("expenseId"),
    paidDate: formData.get("paidDate"),
    paymentMethod: formData.get("paymentMethod"),
  };
}

function invalid(error: ZodError): ExpenseActionState {
  return {
    fieldErrors: error.flatten().fieldErrors,
    message: "Revisá los campos indicados.",
    status: "error",
  };
}

function revalidateExpensePaths() {
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
}

function safeError(error: unknown): ExpenseActionState {
  if (error instanceof ExpenseCategoryUnavailableError) {
    return {
      fieldErrors: { categoryId: ["Elegí una categoría activa propia."] },
      message: "La categoría no está disponible para este gasto.",
      status: "error",
    };
  }
  if (error instanceof ExpenseEditLockedError) {
    return {
      message: "Solo se pueden editar gastos manuales planificados o pendientes.",
      status: "error",
    };
  }
  if (error instanceof ExpensePaymentStateError) {
    return {
      message: "El estado actual del gasto no permite registrar ese pago.",
      status: "error",
    };
  }
  if (error instanceof ExpenseCancellationRestrictedError) {
    return {
      message: "Solo se pueden cancelar gastos planificados o pendientes.",
      status: "error",
    };
  }
  if (error instanceof ExpenseDeleteRestrictedError) {
    return {
      message: "Solo se pueden eliminar gastos manuales planificados o pendientes.",
      status: "error",
    };
  }
  if (error instanceof ExpenseNotFoundError) {
    return {
      message: "El gasto no existe o no te pertenece.",
      status: "error",
    };
  }
  return {
    message: "No pudimos guardar el cambio. Volvé a intentarlo.",
    status: "error",
  };
}

export async function createExpenseAction(
  _state: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const user = await requireUser();
  const parsed = expenseFormSchema.safeParse(expenseValuesFromFormData(formData));
  if (!parsed.success) return invalid(parsed.error);
  if (parsed.data.recurring) {
    return {
      fieldErrors: { recurring: ["Usá el flujo recurrente para crear esta regla."] },
      message: "El gasto manual no puede contener una recurrencia.",
      status: "error",
    };
  }

  try {
    const created = await withAuthenticatedDb(user.id, async (database) => {
      const values = parsed.data;
      if (values.status !== "paid") {
        return createManualExpense(database, { ownerId: user.id, values });
      }

      const paidDate = values.paidDate;
      const paymentMethod = values.paymentMethod;
      if (!paidDate || !paymentMethod) {
        throw new Error("Paid expense metadata was not validated");
      }

      const draft = await createManualExpense(database, {
        ownerId: user.id,
        values: { ...values, paidDate: null, status: "pending" },
      });
      return markExpensePaid(database, {
        expenseId: draft.id,
        ownerId: user.id,
        values: {
          amountMinor: values.amountMinor,
          expenseId: draft.id,
          paidDate,
          paymentMethod,
        },
      });
    });
    revalidateExpensePaths();
    return { expenseId: created.id, status: "success" };
  } catch (error) {
    return safeError(error);
  }
}

export async function updateExpenseAction(
  _state: ExpenseActionState,
  formData: FormData,
): Promise<ExpenseActionState> {
  const user = await requireUser();
  const id = expenseIdSchema.safeParse(formData.get("expenseId"));
  const parsed = expenseFormSchema.safeParse(expenseValuesFromFormData(formData));
  if (!id.success || !parsed.success) {
    return !parsed.success
      ? invalid(parsed.error)
      : { message: "El gasto no es válido.", status: "error" };
  }

  try {
    const updated = await withAuthenticatedDb(user.id, (database) =>
      updateManualExpense(database, {
        expenseId: id.data,
        ownerId: user.id,
        values: parsed.data,
      }),
    );
    revalidateExpensePaths();
    return { expenseId: updated.id, status: "success" };
  } catch (error) {
    return safeError(error);
  }
}

async function runPaymentAction(
  formData: FormData,
  correction: boolean,
): Promise<ExpenseActionState> {
  const user = await requireUser();
  const schema = correction ? expenseCorrectionSchema : expenseMarkPaidSchema;
  const parsed = schema.safeParse(paymentValuesFromFormData(formData));
  if (!parsed.success) return invalid(parsed.error);

  try {
    const updated = await withAuthenticatedDb(user.id, (database) =>
      correction
        ? correctPaidExpense(database, {
            expenseId: parsed.data.expenseId,
            ownerId: user.id,
            values: parsed.data,
          })
        : markExpensePaid(database, {
            expenseId: parsed.data.expenseId,
            ownerId: user.id,
            values: parsed.data,
          }),
    );
    revalidateExpensePaths();
    return { expenseId: updated.id, status: "success" };
  } catch (error) {
    return safeError(error);
  }
}

export async function markExpensePaidAction(
  _state: ExpenseActionState,
  formData: FormData,
) {
  return runPaymentAction(formData, false);
}

export async function correctPaidExpenseAction(
  _state: ExpenseActionState,
  formData: FormData,
) {
  return runPaymentAction(formData, true);
}

async function runExpenseCommand(
  formData: FormData,
  operation: (
    ownerId: string,
    expenseId: string,
  ) => Promise<{ id: string }>,
): Promise<ExpenseActionState> {
  const user = await requireUser();
  const id = expenseIdSchema.safeParse(formData.get("expenseId"));
  if (!id.success) return { message: "El gasto no es válido.", status: "error" };

  try {
    const result = await operation(user.id, id.data);
    revalidateExpensePaths();
    return { expenseId: result.id, status: "success" };
  } catch (error) {
    return safeError(error);
  }
}

export async function cancelExpenseAction(
  _state: ExpenseActionState,
  formData: FormData,
) {
  return runExpenseCommand(formData, (ownerId, expenseId) =>
    withAuthenticatedDb(ownerId, (database) =>
      cancelExpense(database, { expenseId, ownerId }),
    ),
  );
}

export async function deleteExpenseAction(
  _state: ExpenseActionState,
  formData: FormData,
) {
  return runExpenseCommand(formData, (ownerId, expenseId) =>
    withAuthenticatedDb(ownerId, (database) =>
      deleteManualExpense(database, { expenseId, ownerId }),
    ),
  );
}
