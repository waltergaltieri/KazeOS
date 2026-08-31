import { getTableName, type SQL } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

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

const businessTables = [
  clients,
  services,
  charges,
  payments,
  tasks,
  clientNotes,
  settings,
] as const;

const allTables = [profiles, ...businessTables] as const;

function configOf(table: (typeof allTables)[number]) {
  return getTableConfig(table);
}

function columnNames(table: (typeof allTables)[number]) {
  return configOf(table).columns.map((column) => column.name);
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
      /\b(?:profiles|clients|services|charges|payments|tasks|client_notes|settings)\./g,
      "",
    )
    .replace(/\s+/g, " ");
}

function foreignKeyContract(
  table: (typeof allTables)[number],
  name: string,
) {
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
      expect(table.ownerId.notNull).toBe(true);
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

    for (const table of allTables) {
      expect(columnNames(table)).toEqual(
        expect.arrayContaining(["created_at", "updated_at"]),
      );
      expect(table.createdAt.columnType).toBe("PgTimestamp");
      expect(table.updatedAt.columnType).toBe("PgTimestamp");
    }

    expect(renderSql(clients.joinedAt.default as SQL)).toContain(
      "now() at time zone 'America/Argentina/Buenos_Aires'",
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
  });

  it("enables command-specific authenticated policies with retained history", () => {
    for (const table of allTables) {
      const config = configOf(table);
      expect(config.enableRLS).toBe(true);

      const commands = config.policies.map((policy) => policy.for).sort();
      const expectedCommands = ["insert", "select", "update"];
      if (table === tasks || table === clientNotes) {
        expectedCommands.push("delete");
      }

      expect(commands).toEqual(expectedCommands.sort());
      for (const policy of config.policies) {
        expect((policy.to as { name: string }).name).toBe("authenticated");
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

  it("keeps all JavaScript number-mode money inside the safe integer range", () => {
    const moneyChecks = [
      [services, "services_amount_minor_js_safe"],
      [charges, "charges_amount_minor_js_safe"],
      [charges, "charges_amount_paid_minor_valid"],
      [payments, "payments_amount_minor_js_safe"],
    ] as const;

    for (const [table, name] of moneyChecks) {
      const expression = renderSql(
        configOf(table).checks.find((constraint) => constraint.name === name)
          ?.value,
      );
      expect(expression).toContain("9007199254740991");
    }
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
