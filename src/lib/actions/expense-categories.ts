"use server";

import { revalidatePath } from "next/cache";
import { z, type ZodError } from "zod";

import { withAuthenticatedDb } from "@/db";
import { requireUser } from "@/lib/auth/require-user";
import {
  createExpenseCategory,
  ExpenseCategoryDuplicateError,
  ExpenseCategoryNotFoundError,
  toggleExpenseCategory,
  updateExpenseCategory,
} from "@/lib/services/expense-category-manager";
import {
  expenseCategoryFormSchema,
  expenseCategoryIdSchema,
} from "@/lib/validations/expense-category";

export interface ExpenseCategoryActionState {
  status: "idle" | "error" | "success";
  message?: string;
  categoryId?: string;
  active?: boolean;
  fieldErrors?: Record<string, string[]>;
}

const activeSchema = z.enum(["true", "false"]).transform(
  (active) => active === "true",
);

function categoryInputFromFormData(formData: FormData) {
  return {
    name: formData.get("name"),
    icon: formData.get("icon"),
  };
}

function validationError(
  issues: { error: ZodError },
): ExpenseCategoryActionState {
  return {
    status: "error",
    message: "Revisá los campos indicados.",
    fieldErrors: issues.error.flatten().fieldErrors,
  };
}

function duplicateError(): ExpenseCategoryActionState {
  return {
    status: "error",
    message: "Ya existe una categoría con ese nombre.",
    fieldErrors: { name: ["Usá un nombre diferente."] },
  };
}

function refreshExpenseCategoryPaths() {
  revalidatePath("/settings");
  revalidatePath("/expenses");
  revalidatePath("/expenses/new");
}

export async function createExpenseCategoryAction(
  _previousState: ExpenseCategoryActionState,
  formData: FormData,
): Promise<ExpenseCategoryActionState> {
  const user = await requireUser();
  const values = expenseCategoryFormSchema.safeParse(
    categoryInputFromFormData(formData),
  );
  if (!values.success) return validationError(values);

  try {
    const result = await withAuthenticatedDb(user.id, (database) =>
      createExpenseCategory(database, { ownerId: user.id, values: values.data }),
    );
    refreshExpenseCategoryPaths();
    return { status: "success", categoryId: result.id };
  } catch (error) {
    if (error instanceof ExpenseCategoryDuplicateError) return duplicateError();
    return { status: "error", message: "No pudimos crear la categoría." };
  }
}

export async function updateExpenseCategoryAction(
  _previousState: ExpenseCategoryActionState,
  formData: FormData,
): Promise<ExpenseCategoryActionState> {
  const user = await requireUser();
  const categoryId = expenseCategoryIdSchema.safeParse(
    formData.get("categoryId"),
  );
  const values = expenseCategoryFormSchema.safeParse(
    categoryInputFromFormData(formData),
  );

  if (!categoryId.success) {
    return { status: "error", message: "La categoría no es válida." };
  }
  if (!values.success) return validationError(values);

  try {
    const result = await withAuthenticatedDb(user.id, (database) =>
      updateExpenseCategory(database, {
        categoryId: categoryId.data,
        ownerId: user.id,
        values: values.data,
      }),
    );
    refreshExpenseCategoryPaths();
    return { status: "success", categoryId: result.id };
  } catch (error) {
    if (error instanceof ExpenseCategoryDuplicateError) return duplicateError();
    if (error instanceof ExpenseCategoryNotFoundError) {
      return { status: "error", message: "No pudimos encontrar la categoría." };
    }
    return { status: "error", message: "No pudimos actualizar la categoría." };
  }
}

export async function toggleExpenseCategoryAction(
  _previousState: ExpenseCategoryActionState,
  formData: FormData,
): Promise<ExpenseCategoryActionState> {
  const user = await requireUser();
  const categoryId = expenseCategoryIdSchema.safeParse(
    formData.get("categoryId"),
  );
  const active = activeSchema.safeParse(formData.get("active"));

  if (!categoryId.success || !active.success) {
    return { status: "error", message: "La categoría no es válida." };
  }

  try {
    const result = await withAuthenticatedDb(user.id, (database) =>
      toggleExpenseCategory(database, {
        categoryId: categoryId.data,
        ownerId: user.id,
        active: active.data,
      }),
    );
    refreshExpenseCategoryPaths();
    return {
      status: "success",
      categoryId: result.id,
      active: result.active,
    };
  } catch (error) {
    if (error instanceof ExpenseCategoryNotFoundError) {
      return { status: "error", message: "No pudimos encontrar la categoría." };
    }
    return {
      status: "error",
      message: active.data
        ? "No pudimos reactivar la categoría."
        : "No pudimos desactivar la categoría.",
    };
  }
}
