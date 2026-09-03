"use server";

import { revalidatePath } from "next/cache";
import type { ZodError } from "zod";

import { withAuthenticatedDb } from "@/db";
import { requireUser } from "@/lib/auth/require-user";
import { todayInBusinessZone } from "@/lib/domain/commercial-date";
import {
  ExpenseCategoryInactiveError,
  ExpenseCategoryNotFoundError,
} from "@/lib/services/expense-category-manager";
import {
  cancelRecurringExpense,
  createRecurringExpenseWithOccurrences,
  pauseRecurringExpense,
  RecurringExpenseStatusLockedError,
  updateRecurringExpenseWithOccurrences,
  type RecurringExpenseValues,
} from "@/lib/services/recurring-expense-manager";
import {
  expenseFormSchema,
  recurringExpenseIdSchema,
  type ExpenseFormValues,
} from "@/lib/validations/expense";

export interface RecurringExpenseActionState {
  status: "idle" | "error" | "success";
  message?: string;
  recurringExpenseId?: string;
  fieldErrors?: Record<string, string[]>;
}

function expenseInputFromFormData(formData: FormData) {
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

function validationError(error: ZodError): RecurringExpenseActionState {
  return {
    fieldErrors: error.flatten().fieldErrors,
    message: "Revisá los campos indicados.",
    status: "error",
  };
}

function recurringValues(values: ExpenseFormValues): RecurringExpenseValues | null {
  if (!values.recurring) return null;

  return {
    amountMinor: values.amountMinor,
    automaticGeneration: values.automaticGeneration,
    billingDay: values.billingDay,
    categoryId: values.categoryId,
    costType: values.costType,
    currency: values.currency,
    description: values.description,
    endDate: values.endDate,
    frequency: values.frequency,
    notes: values.notes,
    paymentMethod: values.paymentMethod,
    scope: values.scope,
    startDate: values.startDate,
    title: values.title,
    vendor: values.vendor,
  };
}

function revalidateRecurringExpensePaths(recurringExpenseId?: string) {
  revalidatePath("/expenses");
  revalidatePath("/expenses/recurring");
  revalidatePath("/dashboard");
  if (recurringExpenseId) {
    revalidatePath(`/expenses/recurring/${recurringExpenseId}/edit`);
  }
}

function statusLockedError(): RecurringExpenseActionState {
  return {
    fieldErrors: {
      status: ["La cancelación es definitiva para proteger el historial."],
    },
    message: "Un gasto recurrente cancelado no se puede modificar.",
    status: "error",
  };
}

function categoryUnavailableError(): RecurringExpenseActionState {
  return {
    fieldErrors: {
      categoryId: ["Elegí una categoría activa de tu cuenta."],
    },
    message: "La categoría no está disponible.",
    status: "error",
  };
}

function isCategoryUnavailable(error: unknown) {
  return (
    error instanceof ExpenseCategoryInactiveError ||
    error instanceof ExpenseCategoryNotFoundError
  );
}

export async function createRecurringExpenseAction(
  _previousState: RecurringExpenseActionState,
  formData: FormData,
): Promise<RecurringExpenseActionState> {
  const user = await requireUser();
  const parsed = expenseFormSchema.safeParse(expenseInputFromFormData(formData));
  if (!parsed.success) return validationError(parsed.error);

  const values = recurringValues(parsed.data);
  if (!values) {
    return {
      fieldErrors: { recurring: ["Activá la recurrencia para continuar."] },
      message: "El gasto recurrente no es válido.",
      status: "error",
    };
  }

  try {
    const result = await withAuthenticatedDb(user.id, (database) =>
      createRecurringExpenseWithOccurrences(database, {
        asOf: todayInBusinessZone(new Date()),
        ownerId: user.id,
        values,
      }),
    );
    revalidateRecurringExpensePaths(result.id);
    return { recurringExpenseId: result.id, status: "success" };
  } catch (error) {
    if (isCategoryUnavailable(error)) return categoryUnavailableError();
    return {
      message: "No pudimos crear el gasto recurrente.",
      status: "error",
    };
  }
}

export async function updateRecurringExpenseAction(
  _previousState: RecurringExpenseActionState,
  formData: FormData,
): Promise<RecurringExpenseActionState> {
  const user = await requireUser();
  const idResult = recurringExpenseIdSchema.safeParse(
    formData.get("recurringExpenseId"),
  );
  const parsed = expenseFormSchema.safeParse(expenseInputFromFormData(formData));
  if (!idResult.success) {
    return { message: "El gasto recurrente no es válido.", status: "error" };
  }
  if (!parsed.success) return validationError(parsed.error);

  const values = recurringValues(parsed.data);
  if (!values) {
    return {
      fieldErrors: { recurring: ["Activá la recurrencia para continuar."] },
      message: "El gasto recurrente no es válido.",
      status: "error",
    };
  }

  try {
    const result = await withAuthenticatedDb(user.id, (database) =>
      updateRecurringExpenseWithOccurrences(database, {
        asOf: todayInBusinessZone(new Date()),
        ownerId: user.id,
        recurringExpenseId: idResult.data,
        values,
      }),
    );
    revalidateRecurringExpensePaths(result.id);
    return { recurringExpenseId: result.id, status: "success" };
  } catch (error) {
    if (isCategoryUnavailable(error)) return categoryUnavailableError();
    if (error instanceof RecurringExpenseStatusLockedError) {
      return statusLockedError();
    }
    return {
      message: "No pudimos actualizar el gasto recurrente.",
      status: "error",
    };
  }
}

async function runLifecycleAction(
  formData: FormData,
  operation: typeof pauseRecurringExpense | typeof cancelRecurringExpense,
  failureMessage: string,
): Promise<RecurringExpenseActionState> {
  const user = await requireUser();
  const idResult = recurringExpenseIdSchema.safeParse(
    formData.get("recurringExpenseId"),
  );
  if (!idResult.success) {
    return { message: "El gasto recurrente no es válido.", status: "error" };
  }

  try {
    const result = await withAuthenticatedDb(user.id, (database) =>
      operation(database, {
        asOf: todayInBusinessZone(new Date()),
        ownerId: user.id,
        recurringExpenseId: idResult.data,
      }),
    );
    revalidateRecurringExpensePaths(result.id);
    return { recurringExpenseId: result.id, status: "success" };
  } catch (error) {
    if (error instanceof RecurringExpenseStatusLockedError) {
      return statusLockedError();
    }
    return { message: failureMessage, status: "error" };
  }
}

export function pauseRecurringExpenseAction(
  _previousState: RecurringExpenseActionState,
  formData: FormData,
) {
  return runLifecycleAction(
    formData,
    pauseRecurringExpense,
    "No pudimos pausar el gasto recurrente.",
  );
}

export function cancelRecurringExpenseAction(
  _previousState: RecurringExpenseActionState,
  formData: FormData,
) {
  return runLifecycleAction(
    formData,
    cancelRecurringExpense,
    "No pudimos cancelar el gasto recurrente.",
  );
}
