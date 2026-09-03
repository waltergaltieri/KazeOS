import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { withAuthenticatedDb } from "@/db";
import * as schema from "@/db/schema";
import { expenseCategories } from "@/db/schema";
import { requireUser } from "@/lib/auth/require-user";

type ExpenseCategoryDatabase = PostgresJsDatabase<typeof schema>;

export interface ExpenseCategoryListItem {
  id: string;
  name: string;
  icon: string | null;
  active: boolean;
}

export function queryExpenseCategories(
  database: ExpenseCategoryDatabase,
  ownerId: string,
  options: Readonly<{ includeInactive?: boolean }> = {},
): Promise<ExpenseCategoryListItem[]> {
  const ownerCondition = eq(expenseCategories.ownerId, ownerId);
  const visibilityCondition = options.includeInactive
    ? ownerCondition
    : and(ownerCondition, eq(expenseCategories.active, true));

  return database
    .select({
      id: expenseCategories.id,
      name: expenseCategories.name,
      icon: expenseCategories.icon,
      active: expenseCategories.active,
    })
    .from(expenseCategories)
    .where(visibilityCondition)
    .orderBy(
      ...(options.includeInactive ? [desc(expenseCategories.active)] : []),
      asc(sql`lower(${expenseCategories.name})`),
      asc(expenseCategories.id),
    );
}

export async function getExpenseCategories(
  options: Readonly<{ includeInactive?: boolean }> = {},
): Promise<ExpenseCategoryListItem[]> {
  const user = await requireUser();

  return withAuthenticatedDb(user.id, (database) =>
    queryExpenseCategories(database, user.id, options),
  );
}
