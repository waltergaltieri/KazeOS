import { and, asc, eq, ne, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/db/schema";
import { expenses, recurringExpenses } from "@/db/schema";
import { validateCommercialDate } from "@/lib/domain/commercial-date";
import { buildRecurringPeriods } from "@/lib/domain/recurrence";

export interface ExpenseGenerationInput {
  asOf: string;
  horizonMonths?: number;
  ownerId?: string;
  templateId?: string;
}

export interface ExpenseGenerationResult {
  candidates: number;
  eligibleTemplates: number;
  inserted: number;
  skipped: number;
}

export type ExpenseGeneratorDatabase = PostgresJsDatabase<typeof schema>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateInput(input: Readonly<ExpenseGenerationInput>) {
  validateCommercialDate(input.asOf);
  const horizonMonths = input.horizonMonths ?? 3;

  if (!Number.isSafeInteger(horizonMonths) || horizonMonths < 1) {
    throw new RangeError("Horizon must be a positive safe number of months");
  }

  if (input.ownerId !== undefined && !uuidPattern.test(input.ownerId)) {
    throw new RangeError("Owner id must be a UUID");
  }

  if (input.templateId !== undefined && !uuidPattern.test(input.templateId)) {
    throw new RangeError("Template id must be a UUID");
  }

  return {
    horizonMonths,
    ownerId: input.ownerId,
    templateId: input.templateId,
  };
}

/**
 * Generates missing expense occurrences using a transaction-bound database.
 * Template row locks serialize lifecycle changes with cron generation, while
 * the partial unique index remains the final concurrency guard.
 */
export async function generateRecurringExpenses(
  database: ExpenseGeneratorDatabase,
  input: Readonly<ExpenseGenerationInput>,
): Promise<ExpenseGenerationResult> {
  const { horizonMonths, ownerId, templateId } = validateInput(input);
  const eligible = await database
    .select({
      amountMinor: recurringExpenses.amountMinor,
      billingDay: recurringExpenses.billingDay,
      categoryId: recurringExpenses.categoryId,
      costType: recurringExpenses.costType,
      currency: recurringExpenses.currency,
      description: recurringExpenses.description,
      endDate: recurringExpenses.endDate,
      frequency: recurringExpenses.frequency,
      id: recurringExpenses.id,
      notes: recurringExpenses.notes,
      ownerId: recurringExpenses.ownerId,
      paymentMethod: recurringExpenses.paymentMethod,
      scope: recurringExpenses.scope,
      startDate: recurringExpenses.startDate,
      title: recurringExpenses.title,
      vendor: recurringExpenses.vendor,
    })
    .from(recurringExpenses)
    .where(
      and(
        eq(recurringExpenses.status, "active"),
        ne(recurringExpenses.frequency, "one_time"),
        eq(recurringExpenses.automaticGeneration, true),
        ownerId === undefined
          ? undefined
          : eq(recurringExpenses.ownerId, ownerId),
        templateId === undefined
          ? undefined
          : eq(recurringExpenses.id, templateId),
      ),
    )
    .orderBy(asc(recurringExpenses.ownerId), asc(recurringExpenses.id))
    .for("update");

  const values = eligible.flatMap((template) =>
    buildRecurringPeriods(
      {
        amountMinor: template.amountMinor,
        billingDay: template.billingDay,
        endDate: template.endDate,
        frequency: template.frequency as "monthly" | "quarterly" | "yearly",
        label: template.title,
        startDate: template.startDate,
      },
      input.asOf,
      horizonMonths,
    ).map((candidate) => ({
      amountMinor: candidate.amountMinor,
      categoryId: template.categoryId,
      costType: template.costType,
      currency: template.currency,
      description: template.description,
      dueDate: candidate.dueDate,
      generatedAutomatically: true,
      notes: template.notes,
      ownerId: template.ownerId,
      paymentMethod: template.paymentMethod,
      periodKey: candidate.periodKey,
      recurringExpenseId: template.id,
      scope: template.scope,
      status: "pending" as const,
      title: template.title,
      vendor: template.vendor,
    })),
  );

  if (values.length === 0) {
    return {
      candidates: 0,
      eligibleTemplates: eligible.length,
      inserted: 0,
      skipped: 0,
    };
  }

  const insertedRows = await database
    .insert(expenses)
    .values(values)
    .onConflictDoNothing({
      target: [expenses.recurringExpenseId, expenses.periodKey],
      where: sql`${expenses.recurringExpenseId} is not null and ${expenses.periodKey} is not null`,
    })
    .returning({ id: expenses.id });
  const inserted = insertedRows.length;

  return {
    candidates: values.length,
    eligibleTemplates: eligible.length,
    inserted,
    skipped: values.length - inserted,
  };
}
