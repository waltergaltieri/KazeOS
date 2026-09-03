import { and, eq, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/db/schema";
import { expenseCategories } from "@/db/schema";
import {
  expenseCategoryFormSchema,
  type ExpenseCategoryFormValues,
} from "@/lib/validations/expense-category";

type ExpenseCategoryDatabase = PostgresJsDatabase<typeof schema>;

interface ExpenseCategoryScope {
  ownerId: string;
  categoryId: string;
}

export class ExpenseCategoryDuplicateError extends Error {
  constructor() {
    super("An expense category with that name already exists");
    this.name = "ExpenseCategoryDuplicateError";
  }
}

export class ExpenseCategoryNotFoundError extends Error {
  constructor() {
    super("Expense category was not found");
    this.name = "ExpenseCategoryNotFoundError";
  }
}

export class ExpenseCategoryInactiveError extends Error {
  constructor() {
    super("Expense category is inactive");
    this.name = "ExpenseCategoryInactiveError";
  }
}

function categoryWhere(scope: ExpenseCategoryScope) {
  return and(
    eq(expenseCategories.ownerId, scope.ownerId),
    eq(expenseCategories.id, scope.categoryId),
  );
}

function duplicateNameWhere(
  ownerId: string,
  name: string,
  excludedCategoryId?: string,
) {
  const conditions = [
    eq(expenseCategories.ownerId, ownerId),
    sql`lower(${expenseCategories.name}) = lower(${name})`,
  ];

  if (excludedCategoryId) {
    conditions.push(ne(expenseCategories.id, excludedCategoryId));
  }

  return and(...conditions);
}

async function assertNameAvailable(
  database: ExpenseCategoryDatabase,
  ownerId: string,
  name: string,
  excludedCategoryId?: string,
) {
  const [duplicate] = await database
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(duplicateNameWhere(ownerId, name, excludedCategoryId))
    .limit(1);

  if (duplicate) throw new ExpenseCategoryDuplicateError();
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : undefined;
  }

  return false;
}

function normalizedValues(values: ExpenseCategoryFormValues) {
  return expenseCategoryFormSchema.parse(values);
}

export async function createExpenseCategory(
  database: ExpenseCategoryDatabase,
  input: Readonly<{
    ownerId: string;
    values: ExpenseCategoryFormValues;
  }>,
) {
  const values = normalizedValues(input.values);
  await assertNameAvailable(database, input.ownerId, values.name);

  try {
    const [created] = await database
      .insert(expenseCategories)
      .values({ ...values, ownerId: input.ownerId })
      .returning({ id: expenseCategories.id });

    if (!created) throw new Error("Expense category insert did not return a row");
    return created;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ExpenseCategoryDuplicateError();
    throw error;
  }
}

export async function updateExpenseCategory(
  database: ExpenseCategoryDatabase,
  input: Readonly<ExpenseCategoryScope & {
    values: ExpenseCategoryFormValues;
  }>,
) {
  const values = normalizedValues(input.values);
  const [current] = await database
    .select({ id: expenseCategories.id })
    .from(expenseCategories)
    .where(categoryWhere(input))
    .limit(1)
    .for("update");

  if (!current) throw new ExpenseCategoryNotFoundError();
  await assertNameAvailable(
    database,
    input.ownerId,
    values.name,
    input.categoryId,
  );

  try {
    const [updated] = await database
      .update(expenseCategories)
      .set({ ...values, updatedAt: new Date() })
      .where(categoryWhere(input))
      .returning({ id: expenseCategories.id });

    if (!updated) throw new ExpenseCategoryNotFoundError();
    return updated;
  } catch (error) {
    if (isUniqueViolation(error)) throw new ExpenseCategoryDuplicateError();
    throw error;
  }
}

export async function toggleExpenseCategory(
  database: ExpenseCategoryDatabase,
  input: Readonly<ExpenseCategoryScope & { active: boolean }>,
) {
  const [current] = await database
    .select({ id: expenseCategories.id, active: expenseCategories.active })
    .from(expenseCategories)
    .where(categoryWhere(input))
    .limit(1)
    .for("update");

  if (!current) throw new ExpenseCategoryNotFoundError();
  if (current.active === input.active) return current;

  const [updated] = await database
    .update(expenseCategories)
    .set({ active: input.active, updatedAt: new Date() })
    .where(categoryWhere(input))
    .returning({ id: expenseCategories.id, active: expenseCategories.active });

  if (!updated) throw new ExpenseCategoryNotFoundError();
  return updated;
}

export async function assertActiveExpenseCategory(
  database: ExpenseCategoryDatabase,
  input: Readonly<ExpenseCategoryScope>,
) {
  const [category] = await database
    .select({ id: expenseCategories.id, active: expenseCategories.active })
    .from(expenseCategories)
    .where(categoryWhere(input))
    .limit(1);

  if (!category) throw new ExpenseCategoryNotFoundError();
  if (!category.active) throw new ExpenseCategoryInactiveError();
  return category;
}
