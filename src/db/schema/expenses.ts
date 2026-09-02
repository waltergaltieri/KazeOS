import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authenticatedRole, authUid } from "drizzle-orm/supabase";

import {
  currencyEnum,
  expenseCostTypeEnum,
  expenseScopeEnum,
  expenseStatusEnum,
  paymentMethodEnum,
} from "./enums";
import { expenseCategories } from "./expense-categories";
import { recurringExpenses } from "./recurring-expenses";
import {
  auditColumns,
  authenticatedOwnerPolicies,
  ownerIdColumn,
} from "./shared";

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    ownerId: ownerIdColumn(),
    title: text("title").notNull(),
    description: text("description"),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: currencyEnum("currency").notNull(),
    categoryId: uuid("category_id").notNull(),
    scope: expenseScopeEnum("scope").notNull(),
    costType: expenseCostTypeEnum("cost_type").notNull(),
    recurringExpenseId: uuid("recurring_expense_id"),
    periodKey: text("period_key"),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    paidDate: date("paid_date", { mode: "string" }),
    status: expenseStatusEnum("status").default("pending").notNull(),
    paymentMethod: paymentMethodEnum("payment_method"),
    vendor: text("vendor"),
    notes: text("notes"),
    generatedAutomatically: boolean("generated_automatically")
      .default(false)
      .notNull(),
    ...auditColumns(),
  },
  (table) => [
    check("expenses_title_not_blank", sql`btrim(${table.title}) <> ''`),
    check("expenses_amount_minor_positive", sql`${table.amountMinor} > 0`),
    check(
      "expenses_amount_minor_js_safe",
      sql`${table.amountMinor} <= 9007199254740991`,
    ),
    check(
      "expenses_paid_date_status_consistency",
      sql`(
        (${table.status} = 'paid' and ${table.paidDate} is not null)
        or
        (${table.status} <> 'paid' and ${table.paidDate} is null)
      )`,
    ),
    check(
      "expenses_recurrence_consistency",
      sql`(
        (${table.recurringExpenseId} is null and ${table.periodKey} is null and ${table.generatedAutomatically} = false)
        or
        (${table.recurringExpenseId} is not null and ${table.periodKey} is not null and btrim(${table.periodKey}) <> '')
      )`,
    ),
    foreignKey({
      name: "expenses_owner_id_category_id_expense_categories_owner_id_id_fk",
      columns: [table.ownerId, table.categoryId],
      foreignColumns: [expenseCategories.ownerId, expenseCategories.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    foreignKey({
      name: "expenses_recurring_expense_id_owner_id_recurring_expenses_id_owner_id_fk",
      columns: [table.recurringExpenseId, table.ownerId],
      foreignColumns: [recurringExpenses.id, recurringExpenses.ownerId],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    unique("expenses_owner_id_id_unique").on(table.ownerId, table.id),
    index("expenses_owner_id_due_date_idx").on(table.ownerId, table.dueDate),
    index("expenses_owner_id_status_due_date_idx").on(
      table.ownerId,
      table.status,
      table.dueDate,
    ),
    index("expenses_owner_id_category_id_idx").on(
      table.ownerId,
      table.categoryId,
    ),
    index("expenses_owner_id_scope_idx").on(table.ownerId, table.scope),
    index("expenses_owner_id_currency_idx").on(table.ownerId, table.currency),
    index("expenses_recurring_expense_id_owner_id_idx").on(
      table.recurringExpenseId,
      table.ownerId,
    ),
    uniqueIndex("expenses_recurring_period_unique")
      .on(table.recurringExpenseId, table.periodKey)
      .where(
        sql`${table.recurringExpenseId} is not null and ${table.periodKey} is not null`,
      ),
    ...authenticatedOwnerPolicies("expenses", table.ownerId),
    pgPolicy("expenses_authenticated_delete", {
      as: "permissive",
      for: "delete",
      to: authenticatedRole,
      using: sql`${authUid} = ${table.ownerId}
        and ${table.recurringExpenseId} is null
        and ${table.generatedAutomatically} = false
        and ${table.status} in ('planned', 'pending')`,
    }),
  ],
).enableRLS();
