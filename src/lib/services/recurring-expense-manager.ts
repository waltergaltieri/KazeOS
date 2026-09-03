import { and, asc, eq, gte, inArray } from "drizzle-orm";

import { expenses, recurringExpenses } from "@/db/schema";
import {
  buildRecurringPeriods,
  resolveRecurringEditAnchor,
} from "@/lib/domain/recurrence";

import {
  generateRecurringExpenses,
  type ExpenseGenerationResult,
  type ExpenseGeneratorDatabase,
} from "./expense-generator";
import { assertActiveExpenseCategory } from "./expense-category-manager";

type RecurringExpenseInsert = typeof recurringExpenses.$inferInsert;

export interface RecurringExpenseValues {
  amountMinor: number;
  automaticGeneration: boolean;
  billingDay: number;
  categoryId: string;
  costType: RecurringExpenseInsert["costType"];
  currency: RecurringExpenseInsert["currency"];
  description: string | null;
  endDate: string | null;
  frequency: "monthly" | "quarterly" | "yearly";
  notes: string | null;
  paymentMethod: RecurringExpenseInsert["paymentMethod"];
  scope: RecurringExpenseInsert["scope"];
  startDate: string;
  title: string;
  vendor: string | null;
}

interface RecurringExpenseScope {
  asOf: string;
  ownerId: string;
}

export interface CreateRecurringExpenseInput extends RecurringExpenseScope {
  values: RecurringExpenseValues;
}

export interface UpdateRecurringExpenseInput extends RecurringExpenseScope {
  recurringExpenseId: string;
  submittedDueDate?: string;
  values: RecurringExpenseValues;
}

export interface RecurringExpenseLifecycleInput extends RecurringExpenseScope {
  recurringExpenseId: string;
}

export interface RecurringExpenseMutationResult {
  generated: ExpenseGenerationResult;
  id: string;
}

export class RecurringExpenseNotFoundError extends Error {
  constructor() {
    super("Recurring expense was not found");
    this.name = "RecurringExpenseNotFoundError";
  }
}

export class RecurringExpenseStatusLockedError extends Error {
  constructor() {
    super("Cancelled recurring expenses cannot be changed");
    this.name = "RecurringExpenseStatusLockedError";
  }
}

const emptyGenerationResult = (): ExpenseGenerationResult => ({
  candidates: 0,
  eligibleTemplates: 0,
  inserted: 0,
  skipped: 0,
});

function templateWhere(input: {
  ownerId: string;
  recurringExpenseId: string;
}) {
  return and(
    eq(recurringExpenses.id, input.recurringExpenseId),
    eq(recurringExpenses.ownerId, input.ownerId),
  );
}

function futureExpenseWhere(input: RecurringExpenseLifecycleInput) {
  return and(
    eq(expenses.ownerId, input.ownerId),
    eq(expenses.recurringExpenseId, input.recurringExpenseId),
    gte(expenses.dueDate, input.asOf),
  );
}

async function lockTemplate(
  database: ExpenseGeneratorDatabase,
  input: RecurringExpenseLifecycleInput,
) {
  const [current] = await database
    .select({
      amountMinor: recurringExpenses.amountMinor,
      billingDay: recurringExpenses.billingDay,
      categoryId: recurringExpenses.categoryId,
      endDate: recurringExpenses.endDate,
      frequency: recurringExpenses.frequency,
      id: recurringExpenses.id,
      startDate: recurringExpenses.startDate,
      status: recurringExpenses.status,
      title: recurringExpenses.title,
    })
    .from(recurringExpenses)
    .where(templateWhere(input))
    .limit(1)
    .for("update");

  if (!current) throw new RecurringExpenseNotFoundError();
  return current;
}

async function cancelFutureUnpaidProjections(
  database: ExpenseGeneratorDatabase,
  input: RecurringExpenseLifecycleInput,
) {
  await database
    .update(expenses)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        futureExpenseWhere(input),
        eq(expenses.generatedAutomatically, true),
        inArray(expenses.status, ["planned", "pending"]),
      ),
    );
}

export async function createRecurringExpenseWithOccurrences(
  database: ExpenseGeneratorDatabase,
  input: Readonly<CreateRecurringExpenseInput>,
): Promise<RecurringExpenseMutationResult> {
  await assertActiveExpenseCategory(database, {
    categoryId: input.values.categoryId,
    ownerId: input.ownerId,
  });
  const [created] = await database
    .insert(recurringExpenses)
    .values({
      ...input.values,
      ownerId: input.ownerId,
      status: "active",
    })
    .returning({ id: recurringExpenses.id });

  if (!created) throw new Error("Recurring expense insert did not return an id");

  const generated = await generateRecurringExpenses(database, {
    asOf: input.asOf,
    horizonMonths: 3,
    ownerId: input.ownerId,
    templateId: created.id,
  });

  return { generated, id: created.id };
}

export async function updateRecurringExpenseWithOccurrences(
  database: ExpenseGeneratorDatabase,
  input: Readonly<UpdateRecurringExpenseInput>,
): Promise<RecurringExpenseMutationResult> {
  const current = await lockTemplate(database, input);
  if (current.status === "cancelled") {
    throw new RecurringExpenseStatusLockedError();
  }
  if (current.frequency === "one_time") {
    throw new RangeError("Recurring expense cannot use a one-time frequency");
  }
  const values = {
    ...input.values,
    ...(input.submittedDueDate
      ? resolveRecurringEditAnchor(
          {
            amountMinor: current.amountMinor,
            billingDay: current.billingDay,
            endDate: current.endDate,
            frequency: current.frequency,
            label: current.title,
            startDate: current.startDate,
          },
          input.submittedDueDate,
        )
      : {}),
  };
  if (current.categoryId !== values.categoryId) {
    await assertActiveExpenseCategory(database, {
      categoryId: values.categoryId,
      ownerId: input.ownerId,
    });
  }

  await database
    .update(recurringExpenses)
    .set({ ...values, updatedAt: new Date() })
    .where(templateWhere(input));

  if (current.status === "paused") {
    return {
      generated: emptyGenerationResult(),
      id: input.recurringExpenseId,
    };
  }

  const existing = await database
    .select({
      dueDate: expenses.dueDate,
      generatedAutomatically: expenses.generatedAutomatically,
      id: expenses.id,
      periodKey: expenses.periodKey,
      status: expenses.status,
    })
    .from(expenses)
    .where(futureExpenseWhere(input))
    .orderBy(asc(expenses.dueDate), asc(expenses.id))
    .for("update");

  const canGenerate = current.status === "active" && values.automaticGeneration;
  const candidates = canGenerate
    ? buildRecurringPeriods(
        {
          amountMinor: values.amountMinor,
          billingDay: values.billingDay,
          endDate: values.endDate,
          frequency: values.frequency,
          label: values.title,
          startDate: values.startDate,
        },
        input.asOf,
        3,
      )
    : [];
  const candidatesByPeriod = new Map(
    candidates.map((candidate) => [candidate.periodKey, candidate]),
  );
  const mutable = existing.filter(
    (expense) =>
      expense.generatedAutomatically &&
      (expense.status === "planned" || expense.status === "pending"),
  );

  for (const expense of mutable) {
    const candidate = expense.periodKey
      ? candidatesByPeriod.get(expense.periodKey)
      : undefined;
    if (!candidate) continue;

    await database
      .update(expenses)
      .set({
        amountMinor: candidate.amountMinor,
        categoryId: values.categoryId,
        costType: values.costType,
        currency: values.currency,
        description: values.description,
        dueDate: candidate.dueDate,
        notes: values.notes,
        paymentMethod: values.paymentMethod,
        scope: values.scope,
        title: values.title,
        updatedAt: new Date(),
        vendor: values.vendor,
      })
      .where(
        and(
          eq(expenses.id, expense.id),
          eq(expenses.ownerId, input.ownerId),
          eq(expenses.generatedAutomatically, true),
          inArray(expenses.status, ["planned", "pending"]),
          gte(expenses.dueDate, input.asOf),
        ),
      );
  }

  const obsoleteIds = mutable
    .filter(
      (expense) =>
        expense.periodKey === null ||
        !candidatesByPeriod.has(expense.periodKey),
    )
    .map((expense) => expense.id);

  if (obsoleteIds.length > 0) {
    await database
      .delete(expenses)
      .where(
        and(
          inArray(expenses.id, obsoleteIds),
          eq(expenses.ownerId, input.ownerId),
          eq(expenses.recurringExpenseId, input.recurringExpenseId),
          gte(expenses.dueDate, input.asOf),
          eq(expenses.generatedAutomatically, true),
          inArray(expenses.status, ["planned", "pending"]),
        ),
      );
  }

  const generated = canGenerate
    ? await generateRecurringExpenses(database, {
        asOf: input.asOf,
        horizonMonths: 3,
        ownerId: input.ownerId,
        templateId: input.recurringExpenseId,
      })
    : emptyGenerationResult();

  return { generated, id: input.recurringExpenseId };
}

export async function pauseRecurringExpense(
  database: ExpenseGeneratorDatabase,
  input: Readonly<RecurringExpenseLifecycleInput>,
): Promise<RecurringExpenseMutationResult> {
  const current = await lockTemplate(database, input);
  if (current.status === "cancelled") {
    throw new RecurringExpenseStatusLockedError();
  }

  await database
    .update(recurringExpenses)
    .set({ status: "paused", updatedAt: new Date() })
    .where(templateWhere(input));

  return { generated: emptyGenerationResult(), id: input.recurringExpenseId };
}

export async function cancelRecurringExpense(
  database: ExpenseGeneratorDatabase,
  input: Readonly<RecurringExpenseLifecycleInput>,
): Promise<RecurringExpenseMutationResult> {
  await lockTemplate(database, input);
  await database
    .update(recurringExpenses)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(templateWhere(input));
  await cancelFutureUnpaidProjections(database, input);

  return { generated: emptyGenerationResult(), id: input.recurringExpenseId };
}
