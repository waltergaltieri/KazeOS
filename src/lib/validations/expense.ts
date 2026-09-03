import { z } from "zod";

import { parseMoneyInput } from "@/lib/domain/money";
import {
  chargeCurrencySchema,
  commercialDateSchema,
} from "./charge";
import { paymentMethodSchema } from "./payment";

const optionalText = (max: number) => z.preprocess((value) => {
  if (value == null) return null;
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  return normalized || null;
}, z.string().max(max).nullable());

const optionalFilterText = (max: number) => z.preprocess((value) => {
  if (value == null) return undefined;
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  return normalized || undefined;
}, z.string().max(max).optional());

const optionalDate = z.preprocess(
  (value) => value === "" || value == null ? null : value,
  commercialDateSchema.nullable(),
);

const optionalFilterDate = z.preprocess(
  (value) => value === "" || value == null ? undefined : value,
  commercialDateSchema.optional(),
);

const optionalUuid = z.preprocess(
  (value) => value === "" || value == null ? undefined : value,
  z.string().uuid().optional(),
);

const optionalEnum = <T extends z.ZodType>(schema: T) => z.preprocess(
  (value) => value === "" || value == null ? undefined : value,
  schema.optional(),
);

const optionalPaymentMethod = z.preprocess(
  (value) => value === "" || value == null ? null : value,
  paymentMethodSchema.nullable(),
);

const positiveMoney = z.string().trim().superRefine((value, context) => {
  try {
    if (parseMoneyInput(value) <= 0) throw new RangeError();
  } catch {
    context.addIssue({
      code: "custom",
      message: "Ingresá un monto positivo válido.",
    });
  }
}).transform((value) => parseMoneyInput(value));

const billingDay = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const normalized = value.trim();
    return /^\d+$/.test(normalized) ? Number(normalized) : value;
  },
  z.number().int().min(1).max(31),
);

function normalizeCheckboxValue(value: unknown): unknown {
  if (value === true || value === "true" || value === "on") return true;
  if (
    value === false ||
    value === "false" ||
    value === "off" ||
    value === null ||
    value === undefined
  ) return false;
  return value;
}

const checkbox = z.preprocess(
  normalizeCheckboxValue,
  z.boolean(),
);

export const expenseIdSchema = z.string().uuid("El gasto no es válido.");
export const recurringExpenseIdSchema = z.string().uuid(
  "El gasto recurrente no es válido.",
);
export const expenseCurrencySchema = chargeCurrencySchema;
export const expenseScopeSchema = z.enum([
  "personal",
  "business",
  "family",
  "friends",
  "partner",
  "other",
]);
export const expenseCostTypeSchema = z.enum(["fixed", "variable"]);
export const expenseStatusSchema = z.enum([
  "planned",
  "pending",
  "paid",
  "cancelled",
]);
export const recurringExpenseFrequencySchema = z.enum([
  "monthly",
  "quarterly",
  "yearly",
]);

const expenseBaseShape = {
  title: z.string().trim().min(1, "El título es obligatorio.").max(200),
  description: optionalText(2_000),
  amount: positiveMoney,
  currency: expenseCurrencySchema,
  categoryId: z.string().uuid("La categoría no es válida."),
  scope: expenseScopeSchema,
  costType: expenseCostTypeSchema,
  dueDate: commercialDateSchema,
  paidDate: optionalDate,
  status: expenseStatusSchema.default("pending"),
  paymentMethod: optionalPaymentMethod,
  vendor: optionalText(200),
  notes: optionalText(2_000),
};

const oneOffExpenseSchema = z.object({
  ...expenseBaseShape,
  recurring: z.literal(false),
}).strict();

const recurringExpenseSchema = z.object({
  ...expenseBaseShape,
  recurring: z.literal(true),
  frequency: recurringExpenseFrequencySchema,
  billingDay,
  startDate: commercialDateSchema,
  endDate: optionalDate,
  automaticGeneration: checkbox,
}).strict();

export const expenseFormSchema = z.preprocess(
  (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return value;
    }

    const input = value as Record<string, unknown>;
    const recurring = normalizeCheckboxValue(input.recurring);
    const normalized: Record<string, unknown> = {
      ...input,
      recurring,
    };

    if (recurring === false) {
      for (const field of ["frequency", "billingDay", "startDate", "endDate"] as const) {
        const fieldValue = normalized[field];
        if (
          fieldValue == null ||
          (typeof fieldValue === "string" && fieldValue.trim() === "")
        ) {
          delete normalized[field];
        }
      }

      if (normalizeCheckboxValue(normalized.automaticGeneration) === false) {
        delete normalized.automaticGeneration;
      }
    }

    return normalized;
  },
  z.discriminatedUnion("recurring", [
    oneOffExpenseSchema,
    recurringExpenseSchema,
  ]).superRefine((expense, context) => {
    if ((expense.status === "paid") !== (expense.paidDate !== null)) {
      context.addIssue({
        code: "custom",
        path: ["paidDate"],
        message: "La fecha de pago debe coincidir con el estado pagado.",
      });
    }

    if (expense.status === "paid" && expense.paymentMethod === null) {
      context.addIssue({
        code: "custom",
        path: ["paymentMethod"],
        message: "Elegí el método usado para el pago.",
      });
    }

    if (expense.recurring && expense.status === "paid") {
      context.addIssue({
        code: "custom",
        path: ["status"],
        message: "Una recurrencia genera obligaciones pendientes, no pagos históricos.",
      });
    }

    if (
      expense.recurring &&
      expense.endDate !== null &&
      expense.startDate > expense.endDate
    ) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "La fecha de fin no puede ser anterior al inicio.",
      });
    }
  }).transform(({ amount: amountMinor, ...expense }) => ({
    ...expense,
    amountMinor,
  })),
);

const controlledPaymentSchema = z.object({
  expenseId: expenseIdSchema,
  amount: positiveMoney,
  paidDate: commercialDateSchema,
  paymentMethod: paymentMethodSchema,
}).strict().transform(({ amount: amountMinor, ...payment }) => ({
  ...payment,
  amountMinor,
}));

export const expenseMarkPaidSchema = controlledPaymentSchema;
export const expenseCorrectionSchema = controlledPaymentSchema;

const expenseDisplayStatusSchema = z.enum([
  "all",
  "planned",
  "pending",
  "overdue",
  "paid",
  "cancelled",
]);
const expensePeriodSchema = z.enum([
  "current_month",
  "next_month",
  "custom",
  "all",
]);
const expenseRecurrenceFilterSchema = z.enum([
  "all",
  "one_off",
  "recurring",
]);
const optionalMonth = z.preprocess(
  (value) => value === "" || value == null ? undefined : value,
  z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
);

export const expenseFiltersSchema = z.object({
  status: expenseDisplayStatusSchema.default("all"),
  period: expensePeriodSchema.default("current_month"),
  recurrence: expenseRecurrenceFilterSchema.default("all"),
  categoryId: optionalUuid,
  currency: optionalEnum(expenseCurrencySchema),
  scope: optionalEnum(expenseScopeSchema),
  costType: optionalEnum(expenseCostTypeSchema),
  month: optionalMonth,
  from: optionalFilterDate,
  to: optionalFilterDate,
  search: optionalFilterText(160),
}).strict().superRefine((filters, context) => {
  if (filters.from && filters.to && filters.from > filters.to) {
    context.addIssue({
      code: "custom",
      path: ["to"],
      message: "La fecha final no puede ser anterior a la inicial.",
    });
  }

  if (filters.period === "custom" && (!filters.from || !filters.to)) {
    context.addIssue({
      code: "custom",
      path: [filters.from ? "to" : "from"],
      message: "El período personalizado necesita ambas fechas.",
    });
  }
});

export type ExpenseFormValues = z.infer<typeof expenseFormSchema>;
export type ExpenseMarkPaidValues = z.infer<typeof expenseMarkPaidSchema>;
export type ExpenseCorrectionValues = z.infer<typeof expenseCorrectionSchema>;
export type ExpenseFilters = z.infer<typeof expenseFiltersSchema>;
