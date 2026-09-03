import { getTableName, type SQL } from "drizzle-orm";
import {
  type AnyPgTable,
  getTableConfig,
  PgDialect,
} from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as schema from "./index";

import {
  billingFrequencyEnum,
  billingTypeEnum,
  chargeStatusEnum,
  charges,
  clients,
  clientNotes,
  clientStatusEnum,
  currencyEnum,
  paymentMethodEnum,
  payments,
  profiles,
  serviceStatusEnum,
  services,
  settings,
  taskPriorityEnum,
  taskRecurrenceEnum,
  taskStatusEnum,
  tasks,
} from "./index";

type OptionalEnum = { enumValues: string[] } | undefined;
type OptionalTable = AnyPgTable | undefined;

const expenseScopeEnum = (schema as Record<string, unknown>)
  .expenseScopeEnum as OptionalEnum;
const expenseCostTypeEnum = (schema as Record<string, unknown>)
  .expenseCostTypeEnum as OptionalEnum;
const expenseStatusEnum = (schema as Record<string, unknown>)
  .expenseStatusEnum as OptionalEnum;
const recurringExpenseStatusEnum = (schema as Record<string, unknown>)
  .recurringExpenseStatusEnum as OptionalEnum;
const expenseCategories = (schema as Record<string, unknown>)
  .expenseCategories as OptionalTable;
const recurringExpenses = (schema as Record<string, unknown>)
  .recurringExpenses as OptionalTable;
const expenses = (schema as Record<string, unknown>).expenses as OptionalTable;
const kazeosBackendRole = (schema as Record<string, unknown>)
  .kazeosBackendRole as { name: string } | undefined;

const businessTables = [
  clients,
  services,
  charges,
  payments,
  tasks,
  clientNotes,
  settings,
  ...(expenseCategories ? [expenseCategories] : []),
  ...(recurringExpenses ? [recurringExpenses] : []),
  ...(expenses ? [expenses] : []),
] as const;

const allTables = [profiles, ...businessTables] as const;

function configOf(table: AnyPgTable) {
  return getTableConfig(table);
}

function columnNames(table: AnyPgTable) {
  return configOf(table).columns.map((column) => column.name);
}

function requireTable(table: OptionalTable) {
  expect(table).toBeDefined();
  return table as AnyPgTable;
}

function columnOf(table: AnyPgTable, name: string) {
  const column = configOf(table).columns.find((candidate) => candidate.name === name);
  expect(column, `Missing ${getTableName(table)}.${name}`).toBeDefined();
  return column!;
}

const dialect = new PgDialect();

function renderSql(value: SQL | undefined) {
  if (!value) {
    return undefined;
  }

  return dialect
    .sqlToQuery(value)
    .sql.replaceAll('"', "")
    .replace(
      /\b(?:profiles|clients|services|charges|payments|tasks|client_notes|settings|expense_categories|recurring_expenses|expenses)\./g,
      "",
    )
    .replace(/\s+/g, " ");
}

function foreignKeyContract(table: AnyPgTable, name: string) {
  const foreignKey = configOf(table).foreignKeys.find(
    (candidate) => candidate.getName() === name,
  );
  const reference = foreignKey?.reference();

  return {
    columns: reference?.columns.map((column) => column.name),
    foreignTable: reference && getTableName(reference.foreignTable),
    foreignColumns: reference?.foreignColumns.map((column) => column.name),
    onDelete: foreignKey?.onDelete,
  };
}

describe("database schema contract", () => {
  it("exports every public application table under its snake_case name", () => {
    expect(allTables.map(getTableName)).toEqual([
      "profiles",
      "clients",
      "services",
      "charges",
      "payments",
      "tasks",
      "client_notes",
      "settings",
      "expense_categories",
      "recurring_expenses",
      "expenses",
    ]);
  });

  it("declares the complete persisted enum vocabulary", () => {
    expect(currencyEnum.enumValues).toEqual(["USD", "ARS"]);
    expect(clientStatusEnum.enumValues).toEqual([
      "active",
      "paused",
      "archived",
    ]);
    expect(billingTypeEnum.enumValues).toEqual(["recurring", "one_time"]);
    expect(billingFrequencyEnum.enumValues).toEqual([
      "monthly",
      "quarterly",
      "yearly",
      "one_time",
    ]);
    expect(serviceStatusEnum.enumValues).toEqual([
      "active",
      "paused",
      "cancelled",
    ]);
    expect(chargeStatusEnum.enumValues).toEqual([
      "pending",
      "partial",
      "paid",
      "cancelled",
    ]);
    expect(paymentMethodEnum.enumValues).toEqual([
      "bank_transfer",
      "cash",
      "mercadopago",
      "paypal",
      "payoneer",
      "stripe",
      "crypto",
      "other",
      "debit_card",
      "credit_card",
    ]);
    expect(expenseScopeEnum?.enumValues).toEqual([
      "personal",
      "business",
      "family",
      "friends",
      "partner",
      "other",
    ]);
    expect(expenseCostTypeEnum?.enumValues).toEqual(["fixed", "variable"]);
    expect(expenseStatusEnum?.enumValues).toEqual([
      "planned",
      "pending",
      "paid",
      "cancelled",
    ]);
    expect(recurringExpenseStatusEnum?.enumValues).toEqual([
      "active",
      "paused",
      "cancelled",
    ]);
    expect(taskPriorityEnum.enumValues).toEqual(["low", "medium", "high"]);
    expect(taskStatusEnum.enumValues).toEqual(["pending", "completed"]);
    expect(taskRecurrenceEnum.enumValues).toEqual(["monthly"]);
  });

  it("uses UUID primary keys and owner-scopes every business table", () => {
    expect(profiles.id.dataType).toBe("string");
    expect(profiles.id.primary).toBe(true);
    expect(profiles.id.hasDefault).toBe(false);

    for (const table of businessTables) {
      const config = configOf(table);
      const primaryColumns = config.columns.filter((column) => column.primary);

      if (getTableName(table) === "settings") {
        expect(primaryColumns.map((column) => column.name)).toEqual(["owner_id"]);
      } else {
        expect(primaryColumns.map((column) => column.name)).toEqual(["id"]);
        expect(primaryColumns[0]?.dataType).toBe("string");
        expect(primaryColumns[0]?.hasDefault).toBe(true);
      }

      expect(columnNames(table)).toContain("owner_id");
      expect(columnOf(table, "owner_id").notNull).toBe(true);
    }
  });

  it("defines the required commercial fields with safe data modes", () => {
    expect(clients.firstName.notNull).toBe(true);
    expect(clients.joinedAt.columnType).toBe("PgDateString");
    expect(services.amountMinor.columnType).toBe("PgBigInt53");
    expect(services.startDate.columnType).toBe("PgDateString");
    expect(charges.amountMinor.columnType).toBe("PgBigInt53");
    expect(charges.amountPaidMinor.columnType).toBe("PgBigInt53");
    expect(charges.dueDate.columnType).toBe("PgDateString");
    expect(payments.amountMinor.columnType).toBe("PgBigInt53");
    expect(payments.paymentDate.columnType).toBe("PgDateString");
    expect(tasks.dueDate.columnType).toBe("PgDateString");
    expect(settings.locale.name).toBe("locale");
    expect(settings.locale.default).toBe("es-AR");

    for (const table of allTables) {
      expect(columnNames(table)).toEqual(
        expect.arrayContaining(["created_at", "updated_at"]),
      );
      expect(columnOf(table, "created_at").columnType).toBe("PgTimestamp");
      expect(columnOf(table, "updated_at").columnType).toBe("PgTimestamp");
    }

    expect(renderSql(clients.joinedAt.default as SQL)).toContain(
      "now() at time zone 'America/Argentina/Buenos_Aires'",
    );
  });

  it("defines expense fields, defaults, nullability, and safe data modes", () => {
    const categoriesTable = requireTable(expenseCategories);
    const recurringTable = requireTable(recurringExpenses);
    const expensesTable = requireTable(expenses);

    expect(columnNames(categoriesTable)).toEqual([
      "id",
      "owner_id",
      "name",
      "icon",
      "active",
      "created_at",
      "updated_at",
    ]);
    expect(columnOf(categoriesTable, "name").notNull).toBe(true);
    expect(columnOf(categoriesTable, "icon").notNull).toBe(false);
    expect(columnOf(categoriesTable, "active").default).toBe(true);

    expect(columnNames(recurringTable)).toEqual([
      "id",
      "owner_id",
      "title",
      "description",
      "amount_minor",
      "currency",
      "category_id",
      "scope",
      "cost_type",
      "frequency",
      "billing_day",
      "start_date",
      "end_date",
      "status",
      "payment_method",
      "vendor",
      "notes",
      "automatic_generation",
      "created_at",
      "updated_at",
    ]);
    expect(columnOf(recurringTable, "amount_minor").columnType).toBe(
      "PgBigInt53",
    );
    expect(columnOf(recurringTable, "start_date").columnType).toBe(
      "PgDateString",
    );
    expect(columnOf(recurringTable, "end_date").columnType).toBe(
      "PgDateString",
    );
    expect(columnOf(recurringTable, "category_id").notNull).toBe(true);
    expect(columnOf(recurringTable, "status").default).toBe("active");
    expect(columnOf(recurringTable, "payment_method").notNull).toBe(false);
    expect(columnOf(recurringTable, "automatic_generation").default).toBe(
      false,
    );

    expect(columnNames(expensesTable)).toEqual([
      "id",
      "owner_id",
      "title",
      "description",
      "amount_minor",
      "currency",
      "category_id",
      "scope",
      "cost_type",
      "recurring_expense_id",
      "period_key",
      "due_date",
      "paid_date",
      "status",
      "payment_method",
      "vendor",
      "notes",
      "generated_automatically",
      "created_at",
      "updated_at",
    ]);
    expect(columnOf(expensesTable, "amount_minor").columnType).toBe(
      "PgBigInt53",
    );
    expect(columnOf(expensesTable, "due_date").columnType).toBe(
      "PgDateString",
    );
    expect(columnOf(expensesTable, "paid_date").columnType).toBe(
      "PgDateString",
    );
    expect(columnOf(expensesTable, "category_id").notNull).toBe(true);
    expect(columnOf(expensesTable, "recurring_expense_id").notNull).toBe(
      false,
    );
    expect(columnOf(expensesTable, "status").default).toBe("pending");
    expect(columnOf(expensesTable, "payment_method").notNull).toBe(false);
    expect(columnOf(expensesTable, "generated_automatically").default).toBe(
      false,
    );
  });

  it("declares foreign keys, checks, and planned indexes", () => {
    expect(configOf(profiles).foreignKeys).toHaveLength(1);

    for (const table of businessTables) {
      expect(
        configOf(table).foreignKeys.some((foreignKey) =>
          foreignKey.getName().includes("owner_id"),
        ),
      ).toBe(true);
    }

    expect(configOf(services).checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "services_name_not_blank",
        "services_amount_minor_positive",
        "services_amount_minor_js_safe",
        "services_billing_day_range",
        "services_end_date_valid",
        "services_billing_consistency",
      ]),
    );
    expect(configOf(charges).checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "charges_description_not_blank",
        "charges_amount_minor_positive",
        "charges_amount_minor_js_safe",
        "charges_amount_paid_minor_valid",
        "charges_status_amount_paid_consistency",
        "charges_period_key_consistency",
      ]),
    );
    expect(configOf(tasks).checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "tasks_title_not_blank",
        "tasks_recurrence_consistency",
        "tasks_completion_consistency",
      ]),
    );

    expect(configOf(charges).indexes.map((entry) => entry.config.name)).toEqual(
      expect.arrayContaining([
        "charges_owner_id_due_date_idx",
        "charges_owner_id_status_due_date_idx",
        "charges_service_id_period_key_unique",
      ]),
    );
    expect(
      configOf(charges).indexes.find(
        (entry) => entry.config.name === "charges_service_id_period_key_unique",
      )?.config.where,
    ).toBeDefined();
    expect(configOf(tasks).indexes.map((entry) => entry.config.name)).toContain(
      "tasks_owner_id_status_due_date_idx",
    );

    const notesIndex = configOf(clientNotes).indexes.find(
      (entry) => entry.config.name === "client_notes_owner_client_created_idx",
    );
    expect(
      notesIndex?.config.columns.map((column) =>
        "name" in column ? column.name : undefined,
      ),
    ).toEqual(["owner_id", "client_id", "created_at"]);
    const createdAtIndexColumn = notesIndex?.config.columns[2];
    expect(
      createdAtIndexColumn && "indexConfig" in createdAtIndexColumn
        ? createdAtIndexColumn.indexConfig?.order
        : undefined,
    ).toBe("desc");

    expect(
      renderSql(
        configOf(tasks).checks.find(
          (constraint) => constraint.name === "tasks_recurrence_consistency",
        )?.value,
      ),
    ).toContain("recurrence_key is not null");
  });

  it("enforces expense checks and query indexes", () => {
    const categoriesTable = requireTable(expenseCategories);
    const recurringTable = requireTable(recurringExpenses);
    const expensesTable = requireTable(expenses);

    expect(
      configOf(categoriesTable).checks.map((constraint) => constraint.name),
    ).toContain("expense_categories_name_not_blank");
    expect(
      configOf(recurringTable).checks.map((constraint) => constraint.name),
    ).toEqual(
      expect.arrayContaining([
        "recurring_expenses_title_not_blank",
        "recurring_expenses_amount_minor_positive",
        "recurring_expenses_amount_minor_js_safe",
        "recurring_expenses_frequency_recurring",
        "recurring_expenses_billing_day_range",
        "recurring_expenses_end_date_valid",
      ]),
    );
    expect(
      configOf(expensesTable).checks.map((constraint) => constraint.name),
    ).toEqual(
      expect.arrayContaining([
        "expenses_title_not_blank",
        "expenses_amount_minor_positive",
        "expenses_amount_minor_js_safe",
        "expenses_paid_date_status_consistency",
        "expenses_paid_payment_method_consistency",
        "expenses_recurrence_consistency",
      ]),
    );

    const recurringFrequency = renderSql(
      configOf(recurringTable).checks.find(
        (constraint) =>
          constraint.name === "recurring_expenses_frequency_recurring",
      )?.value,
    );
    expect(recurringFrequency).toContain("frequency <> 'one_time'");
    const paidDateStatus = renderSql(
      configOf(expensesTable).checks.find(
        (constraint) =>
          constraint.name === "expenses_paid_date_status_consistency",
      )?.value,
    );
    expect(paidDateStatus).toContain("status = 'paid' and paid_date is not null");
    expect(paidDateStatus).toContain("status <> 'paid' and paid_date is null");
    const paidPaymentMethod = renderSql(
      configOf(expensesTable).checks.find(
        (constraint) =>
          constraint.name === "expenses_paid_payment_method_consistency",
      )?.value,
    );
    expect(paidPaymentMethod).toContain(
      "status <> 'paid' or payment_method is not null",
    );
    const recurrenceConsistency = renderSql(
      configOf(expensesTable).checks.find(
        (constraint) => constraint.name === "expenses_recurrence_consistency",
      )?.value,
    );
    expect(recurrenceConsistency).toContain(
      "recurring_expense_id is null and period_key is null and generated_automatically = false",
    );
    expect(recurrenceConsistency).toContain(
      "recurring_expense_id is not null and period_key is not null",
    );
    expect(recurrenceConsistency).toContain("btrim(period_key) <> ''");

    const categoryNameIndex = configOf(categoriesTable).indexes.find(
      (entry) => entry.config.name === "expense_categories_owner_name_unique",
    );
    expect(categoryNameIndex?.config.unique).toBe(true);
    expect(
      renderSql(categoryNameIndex?.config.columns[1] as SQL | undefined),
    ).toContain("lower(name)");

    expect(
      configOf(recurringTable).indexes.map((entry) => entry.config.name),
    ).toEqual(
      expect.arrayContaining([
        "recurring_expenses_owner_id_status_idx",
        "recurring_expenses_owner_id_category_id_idx",
      ]),
    );
    expect(
      configOf(expensesTable).indexes.map((entry) => entry.config.name),
    ).toEqual(
      expect.arrayContaining([
        "expenses_owner_id_due_date_idx",
        "expenses_owner_id_status_due_date_idx",
        "expenses_owner_id_category_id_idx",
        "expenses_owner_id_scope_idx",
        "expenses_owner_id_currency_idx",
        "expenses_recurring_expense_id_owner_id_idx",
        "expenses_recurring_period_unique",
      ]),
    );
    const recurringPeriodIndex = configOf(expensesTable).indexes.find(
      (entry) => entry.config.name === "expenses_recurring_period_unique",
    );
    expect(recurringPeriodIndex?.config.unique).toBe(true);
    expect(renderSql(recurringPeriodIndex?.config.where)).toContain(
      "recurring_expense_id is not null and period_key is not null",
    );
  });

  it("keeps related rows in the same owner boundary", () => {
    for (const table of [clients, services, charges, tasks]) {
      expect(
        configOf(table).uniqueConstraints.map((constraint) => constraint.name),
      ).toContain(`${getTableName(table)}_owner_id_id_unique`);
    }

    expect(
      foreignKeyContract(
        services,
        "services_owner_id_client_id_clients_owner_id_id_fk",
      ),
    ).toEqual({
      columns: ["owner_id", "client_id"],
      foreignTable: "clients",
      foreignColumns: ["owner_id", "id"],
      onDelete: "restrict",
    });
    expect(
      foreignKeyContract(
        charges,
        "charges_service_owner_client_services_id_owner_client_fk",
      ),
    ).toEqual({
      columns: ["service_id", "owner_id", "client_id"],
      foreignTable: "services",
      foreignColumns: ["id", "owner_id", "client_id"],
      onDelete: "restrict",
    });
    expect(
      foreignKeyContract(
        payments,
        "payments_charge_owner_client_currency_charges_fk",
      ),
    ).toEqual({
      columns: ["charge_id", "owner_id", "client_id", "currency"],
      foreignTable: "charges",
      foreignColumns: ["id", "owner_id", "client_id", "currency"],
      onDelete: "restrict",
    });
    expect(configOf(tasks).foreignKeys.map((key) => key.getName())).toEqual(
      expect.arrayContaining([
        "tasks_owner_id_client_id_clients_owner_id_id_fk",
        "tasks_owner_id_parent_id_tasks_owner_id_id_fk",
      ]),
    );
    expect(configOf(clientNotes).foreignKeys.map((key) => key.getName())).toContain(
      "client_notes_owner_id_client_id_clients_owner_id_id_fk",
    );

    const categoriesTable = requireTable(expenseCategories);
    const recurringTable = requireTable(recurringExpenses);
    const expensesTable = requireTable(expenses);
    for (const table of [categoriesTable, recurringTable, expensesTable]) {
      expect(
        configOf(table).uniqueConstraints.map((constraint) => constraint.name),
      ).toContain(`${getTableName(table)}_owner_id_id_unique`);
    }
    expect(
      foreignKeyContract(
        recurringTable,
        "recurring_expenses_owner_id_category_id_expense_categories_owner_id_id_fk",
      ),
    ).toEqual({
      columns: ["owner_id", "category_id"],
      foreignTable: "expense_categories",
      foreignColumns: ["owner_id", "id"],
      onDelete: "restrict",
    });
    expect(
      foreignKeyContract(
        expensesTable,
        "expenses_owner_id_category_id_expense_categories_owner_id_id_fk",
      ),
    ).toEqual({
      columns: ["owner_id", "category_id"],
      foreignTable: "expense_categories",
      foreignColumns: ["owner_id", "id"],
      onDelete: "restrict",
    });
    expect(
      foreignKeyContract(
        expensesTable,
        "expenses_recurring_expense_id_owner_id_recurring_expenses_id_owner_id_fk",
      ),
    ).toEqual({
      columns: ["recurring_expense_id", "owner_id"],
      foreignTable: "recurring_expenses",
      foreignColumns: ["id", "owner_id"],
      onDelete: "restrict",
    });

    const expenseIndexColumns = configOf(expensesTable).indexes
      .filter((entry) =>
        [
          "expenses_owner_id_category_id_idx",
          "expenses_recurring_expense_id_owner_id_idx",
        ].includes(entry.config.name ?? ""),
      )
      .map((entry) =>
        entry.config.columns.map((column) =>
          "name" in column ? column.name : undefined,
        ),
      );
    expect(expenseIndexColumns).toEqual(
      expect.arrayContaining([
        ["owner_id", "category_id"],
        ["recurring_expense_id", "owner_id"],
      ]),
    );
  });

  it("keeps direct authenticated access read-only for the expense domain", () => {
    expect(kazeosBackendRole?.name).toBe("kazeos_backend");
    const expenseDomainTables = new Set([
      requireTable(expenseCategories),
      requireTable(recurringExpenses),
      requireTable(expenses),
    ]);

    for (const table of allTables) {
      const config = configOf(table);
      expect(config.enableRLS).toBe(true);

      const commands = config.policies.map((policy) => policy.for).sort();
      const expectedCommands = ["insert", "select", "update"];
      if (table === tasks || table === clientNotes || table === expenses) {
        expectedCommands.push("delete");
      }

      expect(commands).toEqual(expectedCommands.sort());
      for (const policy of config.policies) {
        const expectedRole = expenseDomainTables.has(table) && policy.for !== "select"
          ? "kazeos_backend"
          : "authenticated";
        expect((policy.to as { name: string }).name).toBe(expectedRole);
        expect(policy.for).not.toBe("all");

        if (policy.for !== "insert") {
          expect(renderSql(policy.using)).toContain("select auth.uid()");
        }
        if (policy.for === "insert" || policy.for === "update") {
          expect(renderSql(policy.withCheck)).toContain("select auth.uid()");
        }
      }
    }
  });

  it("restricts expense deletion to eligible manual rows owned by the user", () => {
    const expensesTable = requireTable(expenses);
    const deletePolicies = configOf(expensesTable).policies.filter(
      (policy) => policy.for === "delete",
    );

    expect(deletePolicies).toHaveLength(1);
    expect((deletePolicies[0]?.to as { name: string }).name).toBe(
      "kazeos_backend",
    );
    const using = renderSql(deletePolicies[0]?.using);
    expect(using).toContain("select auth.uid()");
    expect(using).toContain("recurring_expense_id is null");
    expect(using).toContain("generated_automatically = false");
    expect(using).toContain("status in ('planned', 'pending')");
  });

  it("keeps all JavaScript number-mode money inside the safe integer range", () => {
    const moneyChecks = [
      [services, "services_amount_minor_js_safe"],
      [charges, "charges_amount_minor_js_safe"],
      [charges, "charges_amount_paid_minor_valid"],
      [payments, "payments_amount_minor_js_safe"],
      [requireTable(recurringExpenses), "recurring_expenses_amount_minor_js_safe"],
      [requireTable(expenses), "expenses_amount_minor_js_safe"],
    ] as const;

    for (const [table, name] of moneyChecks) {
      const expression = renderSql(
        configOf(table).checks.find((constraint) => constraint.name === name)
          ?.value,
      );
      expect(expression).toContain("9007199254740991");
    }
  });

  it("exports expense relation metadata", () => {
    expect((schema as Record<string, unknown>).expenseCategoriesRelations).toBeDefined();
    expect((schema as Record<string, unknown>).recurringExpensesRelations).toBeDefined();
    expect((schema as Record<string, unknown>).expensesRelations).toBeDefined();
  });

  it("allows overpayment only when the persisted status agrees", () => {
    const paidAmountCheck = renderSql(
      configOf(charges).checks.find(
        (constraint) => constraint.name === "charges_amount_paid_minor_valid",
      )?.value,
    );
    const statusCheck = renderSql(
      configOf(charges).checks.find(
        (constraint) =>
          constraint.name === "charges_status_amount_paid_consistency",
      )?.value,
    );

    expect(paidAmountCheck).not.toContain("<= amount_minor");
    expect(statusCheck).toContain("status = 'pending' and amount_paid_minor = 0");
    expect(statusCheck).toContain(
      "status = 'partial' and amount_paid_minor > 0 and amount_paid_minor < amount_minor",
    );
    expect(statusCheck).toContain(
      "status = 'paid' and amount_paid_minor >= amount_minor",
    );
  });
});
