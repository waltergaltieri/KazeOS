import { and, eq, inArray, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/db/schema";
import { expenseCategories, expenses } from "@/db/schema";
import type {
  ExpenseCorrectionValues,
  ExpenseFormValues,
  ExpenseMarkPaidValues,
} from "@/lib/validations/expense";

type ExpenseDatabase = PostgresJsDatabase<typeof schema>;
type ExpenseScope = { ownerId: string; expenseId: string };

export class ExpenseNotFoundError extends Error {}
export class ExpenseCategoryUnavailableError extends Error {}
export class ExpenseEditLockedError extends Error {}
export class ExpensePaymentStateError extends Error {}
export class ExpenseCancellationRestrictedError extends Error {}
export class ExpenseDeleteRestrictedError extends Error {}

async function assertActiveOwnedCategory(
  database: ExpenseDatabase,
  ownerId: string,
  categoryId: string,
  allowedInactiveCategoryId?: string,
) {
  const [category] = await database
    .select({ active: expenseCategories.active, id: expenseCategories.id })
    .from(expenseCategories)
    .where(and(
      eq(expenseCategories.id, categoryId),
      eq(expenseCategories.ownerId, ownerId),
    ))
    .limit(1)
    .for("share");

  if (
    !category ||
    (!category.active && category.id !== allowedInactiveCategoryId)
  ) {
    throw new ExpenseCategoryUnavailableError();
  }
}

async function lockExpense(database: ExpenseDatabase, scope: ExpenseScope) {
  const [expense] = await database
    .select({
      categoryId: expenses.categoryId,
      generatedAutomatically: expenses.generatedAutomatically,
      id: expenses.id,
      recurringExpenseId: expenses.recurringExpenseId,
      status: expenses.status,
    })
    .from(expenses)
    .where(and(
      eq(expenses.id, scope.expenseId),
      eq(expenses.ownerId, scope.ownerId),
    ))
    .limit(1)
    .for("update");

  if (!expense) throw new ExpenseNotFoundError();
  return expense;
}

function assertManualUnpaidValues(values: ExpenseFormValues) {
  if (
    values.recurring ||
    (values.status !== "planned" && values.status !== "pending") ||
    values.paidDate !== null
  ) {
    throw new ExpenseEditLockedError();
  }
}

function manualExpenseColumns(values: ExpenseFormValues & { recurring: false }) {
  return {
    amountMinor: values.amountMinor,
    categoryId: values.categoryId,
    costType: values.costType,
    currency: values.currency,
    description: values.description,
    dueDate: values.dueDate,
    notes: values.notes,
    paidDate: null,
    paymentMethod: values.paymentMethod,
    scope: values.scope,
    status: values.status,
    title: values.title,
    vendor: values.vendor,
  };
}

export async function createManualExpense(
  database: ExpenseDatabase,
  input: { ownerId: string; values: ExpenseFormValues },
) {
  assertManualUnpaidValues(input.values);
  await assertActiveOwnedCategory(
    database,
    input.ownerId,
    input.values.categoryId,
  );

  const values = input.values as ExpenseFormValues & { recurring: false };
  const [created] = await database
    .insert(expenses)
    .values({
      ...manualExpenseColumns(values),
      generatedAutomatically: false,
      ownerId: input.ownerId,
      periodKey: null,
      recurringExpenseId: null,
    })
    .returning({ id: expenses.id });

  if (!created) throw new Error("Expense insert did not return a row");
  return created;
}

export async function updateManualExpense(
  database: ExpenseDatabase,
  input: ExpenseScope & { values: ExpenseFormValues },
) {
  const current = await lockExpense(database, input);
  assertManualUnpaidValues(input.values);
  if (
    current.generatedAutomatically ||
    current.recurringExpenseId !== null ||
    (current.status !== "planned" && current.status !== "pending")
  ) {
    throw new ExpenseEditLockedError();
  }

  await assertActiveOwnedCategory(
    database,
    input.ownerId,
    input.values.categoryId,
    current.categoryId,
  );
  const values = input.values as ExpenseFormValues & { recurring: false };
  const [updated] = await database
    .update(expenses)
    .set({
      ...manualExpenseColumns(values),
      updatedAt: new Date(),
    })
    .where(and(
      eq(expenses.id, input.expenseId),
      eq(expenses.ownerId, input.ownerId),
      eq(expenses.generatedAutomatically, false),
      isNull(expenses.recurringExpenseId),
      inArray(expenses.status, ["planned", "pending"]),
    ))
    .returning({ id: expenses.id });

  if (!updated) throw new ExpenseEditLockedError();
  return updated;
}

export async function markExpensePaid(
  database: ExpenseDatabase,
  input: ExpenseScope & { values: ExpenseMarkPaidValues },
) {
  if (input.values.expenseId !== input.expenseId) {
    throw new ExpenseNotFoundError();
  }
  const current = await lockExpense(database, input);
  if (current.status !== "planned" && current.status !== "pending") {
    throw new ExpensePaymentStateError();
  }

  const [updated] = await database
    .update(expenses)
    .set({
      amountMinor: input.values.amountMinor,
      paidDate: input.values.paidDate,
      paymentMethod: input.values.paymentMethod,
      status: "paid",
      updatedAt: new Date(),
    })
    .where(and(
      eq(expenses.id, input.expenseId),
      eq(expenses.ownerId, input.ownerId),
      inArray(expenses.status, ["planned", "pending"]),
    ))
    .returning({ id: expenses.id });

  if (!updated) throw new ExpensePaymentStateError();
  return updated;
}

export async function correctPaidExpense(
  database: ExpenseDatabase,
  input: ExpenseScope & { values: ExpenseCorrectionValues },
) {
  if (input.values.expenseId !== input.expenseId) {
    throw new ExpenseNotFoundError();
  }
  const current = await lockExpense(database, input);
  if (current.status !== "paid") throw new ExpensePaymentStateError();

  const [updated] = await database
    .update(expenses)
    .set({
      amountMinor: input.values.amountMinor,
      paidDate: input.values.paidDate,
      paymentMethod: input.values.paymentMethod,
      status: "paid",
      updatedAt: new Date(),
    })
    .where(and(
      eq(expenses.id, input.expenseId),
      eq(expenses.ownerId, input.ownerId),
      eq(expenses.status, "paid"),
    ))
    .returning({ id: expenses.id });

  if (!updated) throw new ExpensePaymentStateError();
  return updated;
}

export async function cancelExpense(
  database: ExpenseDatabase,
  input: ExpenseScope,
) {
  const current = await lockExpense(database, input);
  if (current.status !== "planned" && current.status !== "pending") {
    throw new ExpenseCancellationRestrictedError();
  }

  const [updated] = await database
    .update(expenses)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(
      eq(expenses.id, input.expenseId),
      eq(expenses.ownerId, input.ownerId),
      inArray(expenses.status, ["planned", "pending"]),
    ))
    .returning({ id: expenses.id });

  if (!updated) throw new ExpenseCancellationRestrictedError();
  return updated;
}

export async function deleteManualExpense(
  database: ExpenseDatabase,
  input: ExpenseScope,
) {
  const current = await lockExpense(database, input);
  if (
    current.generatedAutomatically ||
    current.recurringExpenseId !== null ||
    (current.status !== "planned" && current.status !== "pending")
  ) {
    throw new ExpenseDeleteRestrictedError();
  }

  const [deleted] = await database
    .delete(expenses)
    .where(and(
      eq(expenses.id, input.expenseId),
      eq(expenses.ownerId, input.ownerId),
      eq(expenses.generatedAutomatically, false),
      isNull(expenses.recurringExpenseId),
      inArray(expenses.status, ["planned", "pending"]),
    ))
    .returning({ id: expenses.id });

  if (!deleted) throw new ExpenseDeleteRestrictedError();
  return deleted;
}
