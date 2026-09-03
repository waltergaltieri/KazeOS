import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  billingFrequencyEnum,
  currencyEnum,
  expenseCostTypeEnum,
  expenseScopeEnum,
  paymentMethodEnum,
  recurringExpenseStatusEnum,
} from "./enums";
import { expenseCategories } from "./expense-categories";
import {
  auditColumns,
  authenticatedOwnerPolicies,
  ownerIdColumn,
} from "./shared";
import { kazeosBackendRole } from "./roles";

export const recurringExpenses = pgTable(
  "recurring_expenses",
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
    frequency: billingFrequencyEnum("frequency").notNull(),
    billingDay: integer("billing_day").notNull(),
    startDate: date("start_date", { mode: "string" }).notNull(),
    endDate: date("end_date", { mode: "string" }),
    status: recurringExpenseStatusEnum("status").default("active").notNull(),
    paymentMethod: paymentMethodEnum("payment_method"),
    vendor: text("vendor"),
    notes: text("notes"),
    automaticGeneration: boolean("automatic_generation")
      .default(false)
      .notNull(),
    ...auditColumns(),
  },
  (table) => [
    check(
      "recurring_expenses_title_not_blank",
      sql`btrim(${table.title}) <> ''`,
    ),
    check(
      "recurring_expenses_amount_minor_positive",
      sql`${table.amountMinor} > 0`,
    ),
    check(
      "recurring_expenses_amount_minor_js_safe",
      sql`${table.amountMinor} <= 9007199254740991`,
    ),
    check(
      "recurring_expenses_frequency_recurring",
      sql`${table.frequency} <> 'one_time'`,
    ),
    check(
      "recurring_expenses_billing_day_range",
      sql`${table.billingDay} between 1 and 31`,
    ),
    check(
      "recurring_expenses_end_date_valid",
      sql`${table.endDate} is null or ${table.endDate} >= ${table.startDate}`,
    ),
    foreignKey({
      name: "recurring_expenses_owner_id_category_id_expense_categories_owner_id_id_fk",
      columns: [table.ownerId, table.categoryId],
      foreignColumns: [expenseCategories.ownerId, expenseCategories.id],
    })
      .onDelete("restrict")
      .onUpdate("cascade"),
    unique("recurring_expenses_owner_id_id_unique").on(
      table.ownerId,
      table.id,
    ),
    unique("recurring_expenses_id_owner_id_unique").on(
      table.id,
      table.ownerId,
    ),
    index("recurring_expenses_owner_id_status_idx").on(
      table.ownerId,
      table.status,
    ),
    index("recurring_expenses_owner_id_category_id_idx").on(
      table.ownerId,
      table.categoryId,
    ),
    ...authenticatedOwnerPolicies("recurring_expenses", table.ownerId, {
      writePolicyAudience: "backend",
      writeRole: kazeosBackendRole,
    }),
  ],
).enableRLS();
