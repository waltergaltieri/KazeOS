import { describe, expect, it } from "vitest";

import {
  expenseCorrectionSchema,
  expenseFiltersSchema,
  expenseFormSchema,
  expenseIdSchema,
  expenseMarkPaidSchema,
  recurringExpenseIdSchema,
} from "./expense";

const categoryId = "11111111-1111-4111-8111-111111111111";
const expenseId = "22222222-2222-4222-8222-222222222222";

const baseExpense = {
  title: "Internet",
  amount: "45.000",
  currency: "ARS",
  categoryId,
  scope: "personal",
  costType: "fixed",
  dueDate: "2026-09-05",
  status: "pending",
  recurring: "off",
} as const;

describe("expense validation", () => {
  it("normalizes a locale-safe one-off expense to minor units and null optionals", () => {
    expect(expenseFormSchema.parse({
      ...baseExpense,
      title: "  Internet  ",
      description: "  ",
      paidDate: "",
      paymentMethod: "",
      vendor: "   ",
      notes: null,
    })).toEqual({
      title: "Internet",
      amountMinor: 4_500_000,
      currency: "ARS",
      categoryId,
      scope: "personal",
      costType: "fixed",
      dueDate: "2026-09-05",
      status: "pending",
      description: null,
      paidDate: null,
      paymentMethod: null,
      vendor: null,
      notes: null,
      recurring: false,
    });
  });

  it.each([
    "title",
    "amount",
    "currency",
    "categoryId",
    "scope",
    "costType",
    "dueDate",
  ] as const)("requires the base field %s", (field) => {
    const invalid = { ...baseExpense } as Record<string, unknown>;
    delete invalid[field];

    expect(expenseFormSchema.safeParse(invalid).success).toBe(false);
  });

  it("defaults status to pending and recurrence to off", () => {
    const input = { ...baseExpense } as Record<string, unknown>;
    delete input.status;
    delete input.recurring;

    expect(expenseFormSchema.parse(input)).toMatchObject({
      status: "pending",
      recurring: false,
    });
  });

  it.each(["banana", 1])(
    "rejects an unknown recurrence boolean value %j",
    (recurring) => {
      expect(expenseFormSchema.safeParse({
        ...baseExpense,
        recurring,
      }).success).toBe(false);
    },
  );

  it.each(["banana", 1])(
    "rejects an unknown automatic generation boolean value %j",
    (automaticGeneration) => {
      expect(expenseFormSchema.safeParse({
        ...baseExpense,
        recurring: "on",
        frequency: "monthly",
        billingDay: "5",
        startDate: "2026-09-05",
        automaticGeneration,
      }).success).toBe(false);
    },
  );

  it.each([
    ["currency", "EUR"],
    ["scope", "company"],
    ["costType", "mixed"],
    ["status", "overdue"],
  ])("rejects unsupported %s values", (field, value) => {
    expect(expenseFormSchema.safeParse({
      ...baseExpense,
      [field]: value,
    }).success).toBe(false);
  });

  it.each(["0", "-1", "9.007.199.254.740.992"])(
    "rejects an invalid or unsafe amount %s",
    (amount) => {
      expect(expenseFormSchema.safeParse({ ...baseExpense, amount }).success)
        .toBe(false);
    },
  );

  it("requires a paid date and payment method exactly when status is paid", () => {
    expect(expenseFormSchema.safeParse({
      ...baseExpense,
      status: "paid",
      paidDate: "",
    }).success).toBe(false);
    expect(expenseFormSchema.safeParse({
      ...baseExpense,
      status: "paid",
      paidDate: "2026-09-06",
    }).success).toBe(false);
    expect(expenseFormSchema.safeParse({
      ...baseExpense,
      status: "paid",
      paidDate: "2026-09-06",
      paymentMethod: "credit_card",
    }).success).toBe(true);
    expect(expenseFormSchema.safeParse({
      ...baseExpense,
      paidDate: "2026-09-06",
    }).success).toBe(false);
  });

  it("rejects paid state for recurring templates", () => {
    expect(expenseFormSchema.safeParse({
      ...baseExpense,
      recurring: "on",
      frequency: "monthly",
      billingDay: "5",
      startDate: "2026-09-05",
      status: "paid",
      paidDate: "2026-09-05",
      paymentMethod: "credit_card",
    }).success).toBe(false);
  });

  it("does not require recurrence fields for a one-off expense", () => {
    expect(expenseFormSchema.safeParse(baseExpense).success).toBe(true);
  });

  it("drops empty FormData-shaped recurrence fields for a one-off expense", () => {
    const parsed = expenseFormSchema.parse({
      ...baseExpense,
      recurring: false,
      frequency: null,
      billingDay: "",
      startDate: "",
      endDate: null,
      automaticGeneration: null,
    });

    expect(parsed).toMatchObject({ recurring: false });
    expect(parsed).not.toHaveProperty("frequency");
    expect(parsed).not.toHaveProperty("billingDay");
    expect(parsed).not.toHaveProperty("startDate");
    expect(parsed).not.toHaveProperty("endDate");
    expect(parsed).not.toHaveProperty("automaticGeneration");
  });

  it.each([
    ["frequency", "monthly"],
    ["billingDay", "5"],
    ["startDate", "2026-09-05"],
    ["endDate", "2027-09-05"],
    ["automaticGeneration", "on"],
  ])(
    "does not hide substantive one-off recurrence input in %s",
    (field, value) => {
      expect(expenseFormSchema.safeParse({
        ...baseExpense,
        recurring: false,
        frequency: null,
        billingDay: "",
        startDate: "",
        endDate: null,
        automaticGeneration: null,
        [field]: value,
      }).success).toBe(false);
    },
  );

  it.each(["frequency", "billingDay", "startDate"] as const)(
    "requires %s for a recurring expense",
    (field) => {
      const recurring = {
        ...baseExpense,
        recurring: "on",
        frequency: "monthly",
        billingDay: "5",
        startDate: "2026-09-05",
        endDate: "",
        automaticGeneration: "on",
      } as Record<string, unknown>;
      delete recurring[field];

      expect(expenseFormSchema.safeParse(recurring).success).toBe(false);
    },
  );

  it("normalizes recurring input and validates its range and dates", () => {
    expect(expenseFormSchema.parse({
      ...baseExpense,
      recurring: "on",
      frequency: "quarterly",
      billingDay: "31",
      startDate: "2026-09-05",
      endDate: "2027-09-05",
      automaticGeneration: "true",
    })).toMatchObject({
      amountMinor: 4_500_000,
      recurring: true,
      frequency: "quarterly",
      billingDay: 31,
      startDate: "2026-09-05",
      endDate: "2027-09-05",
      automaticGeneration: true,
    });

    expect(expenseFormSchema.safeParse({
      ...baseExpense,
      recurring: "on",
      frequency: "one_time",
      billingDay: "5",
      startDate: "2026-09-05",
    }).success).toBe(false);
    expect(expenseFormSchema.safeParse({
      ...baseExpense,
      recurring: "on",
      frequency: "monthly",
      billingDay: "32",
      startDate: "2026-09-05",
    }).success).toBe(false);
    expect(expenseFormSchema.safeParse({
      ...baseExpense,
      recurring: "on",
      frequency: "monthly",
      billingDay: "5",
      startDate: "2026-09-05",
      endDate: "2026-09-04",
    }).success).toBe(false);
  });

  it.each([
    [" 1 ", 1],
    ["31", 31],
  ])("accepts billing day boundary %j", (billingDay, expected) => {
    expect(expenseFormSchema.parse({
      ...baseExpense,
      recurring: "on",
      frequency: "monthly",
      billingDay,
      startDate: "2026-09-05",
    })).toMatchObject({ billingDay: expected });
  });

  it.each(["0", "32", "1e1", "0x10", "1.5", "1,5"])(
    "rejects non-decimal or out-of-range billing day %j",
    (billingDay) => {
      expect(expenseFormSchema.safeParse({
        ...baseExpense,
        recurring: "on",
        frequency: "monthly",
        billingDay,
        startDate: "2026-09-05",
      }).success).toBe(false);
    },
  );

  it("validates expense and recurring expense identifiers", () => {
    expect(expenseIdSchema.parse(expenseId)).toBe(expenseId);
    expect(recurringExpenseIdSchema.parse(categoryId)).toBe(categoryId);
    expect(expenseIdSchema.safeParse("expense-1").success).toBe(false);
    expect(recurringExpenseIdSchema.safeParse("").success).toBe(false);
  });

  it.each([expenseMarkPaidSchema, expenseCorrectionSchema])(
    "normalizes controlled payment input",
    (schema) => {
      expect(schema.parse({
        expenseId,
        amount: "1.250,50",
        paidDate: "2026-09-06",
        paymentMethod: "debit_card",
      })).toEqual({
        expenseId,
        amountMinor: 125_050,
        paidDate: "2026-09-06",
        paymentMethod: "debit_card",
      });
      expect(schema.safeParse({
        expenseId: "invalid",
        amount: "0",
        paidDate: "2026-02-30",
        paymentMethod: "card",
      }).success).toBe(false);
    },
  );
});

describe("expense filter validation", () => {
  it("applies defaults and normalizes empty optional filters", () => {
    expect(expenseFiltersSchema.parse({
      categoryId: "",
      currency: "",
      scope: "",
      costType: null,
      month: "",
      from: "",
      to: null,
      search: "   ",
    })).toEqual({
      status: "all",
      period: "current_month",
      recurrence: "all",
      categoryId: undefined,
      currency: undefined,
      scope: undefined,
      costType: undefined,
      month: undefined,
      from: undefined,
      to: undefined,
      search: undefined,
    });
  });

  it("accepts state, month, custom range, category, classification and currency filters", () => {
    expect(expenseFiltersSchema.parse({
      status: "overdue",
      period: "custom",
      recurrence: "recurring",
      categoryId,
      currency: "USD",
      scope: "business",
      costType: "variable",
      month: "2026-09",
      from: "2026-09-01",
      to: "2026-09-30",
      search: "  hosting  ",
    })).toEqual({
      status: "overdue",
      period: "custom",
      recurrence: "recurring",
      categoryId,
      currency: "USD",
      scope: "business",
      costType: "variable",
      month: "2026-09",
      from: "2026-09-01",
      to: "2026-09-30",
      search: "hosting",
    });
  });

  it.each([
    ["status", "late"],
    ["period", "weekly"],
    ["recurrence", "sometimes"],
    ["categoryId", "category-1"],
    ["currency", "EUR"],
    ["scope", "company"],
    ["costType", "mixed"],
    ["month", "2026-13"],
    ["from", "01/09/2026"],
    ["to", "2026-02-30"],
  ])("rejects invalid %s query values", (field, value) => {
    expect(expenseFiltersSchema.safeParse({ [field]: value }).success).toBe(false);
  });

  it("rejects incomplete or reversed custom ranges", () => {
    expect(expenseFiltersSchema.safeParse({
      period: "custom",
      from: "2026-09-01",
    }).success).toBe(false);
    expect(expenseFiltersSchema.safeParse({
      period: "custom",
      from: "2026-09-30",
      to: "2026-09-01",
    }).success).toBe(false);
  });
});
