// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { createDemoSeedData, DEMO_SEED_REFERENCE_DATE } from "./seed-data";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const expectedExpenseCategories = [
  "Servicios",
  "Software",
  "Comida",
  "Transporte",
  "Ropa",
  "Equipamiento",
  "Hogar",
  "Salud",
  "Educación",
  "Entretenimiento",
  "Impuestos",
  "Marketing",
  "Viajes",
  "Suscripciones",
  "Honorarios",
  "Otros",
] as const;

describe("demo seed contract", () => {
  it("is deterministic, owner-specific and uses stable UUIDs", () => {
    const first = createDemoSeedData(ownerId);
    const second = createDemoSeedData(ownerId);
    const anotherOwner = createDemoSeedData("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");

    expect(first).toEqual(second);
    expect(first.referenceDate).toBe("2026-08-31");
    expect(DEMO_SEED_REFERENCE_DATE).toBe("2026-08-31");
    expect(first.clients[0]?.id).not.toBe(anotherOwner.clients[0]?.id);
    const ids = Object.values(first).flatMap((value) => Array.isArray(value) ? value.map((row) => row.id) : []);
    expect(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[45][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("contains the complete dashboard scenario without wall-clock dates", () => {
    const data = createDemoSeedData(ownerId);
    expect(data.clients.map((client) => client.firstName)).toEqual([
      "Estudio Norte", "Empresa Demo", "Cliente Global", "Tech Solutions", "StartUp Labs",
    ]);
    expect(data.clients.every((client) => client.status === "active")).toBe(true);
    expect(new Set(data.services.map((service) => service.currency))).toEqual(new Set(["USD", "ARS"]));
    expect(data.payments.length).toBeGreaterThanOrEqual(3);
    expect(data.tasks.length).toBeGreaterThanOrEqual(5);
    expect(data.notes.length).toBeGreaterThanOrEqual(3);

    const paymentTotals = new Map<string, number>();
    for (const payment of data.payments) paymentTotals.set(payment.chargeId, (paymentTotals.get(payment.chargeId) ?? 0) + payment.amountMinor);
    const derived = data.charges.map((charge) => {
      const paid = paymentTotals.get(charge.id) ?? 0;
      if (paid >= charge.amountMinor) return "paid";
      if (paid > 0) return "partial";
      return charge.dueDate < data.referenceDate ? "overdue" : "pending";
    });
    expect(new Set(derived)).toEqual(new Set(["paid", "partial", "overdue", "pending"]));
    const source = readFileSync(new URL("./seed-data.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/Date\.now\s*\(|new Date\(\s*\)/);
  });

  it("contains the exact approved expense categories, templates and examples", () => {
    const data = createDemoSeedData(ownerId) as ReturnType<
      typeof createDemoSeedData
    > & {
      expenseCategories: Array<{
        id: string;
        name: string;
      }>;
      expenses: Array<{
        amountMinor: number;
        categoryId: string;
        costType: string;
        currency: string;
        dueDate: string;
        generatedAutomatically: boolean;
        paidDate: string | null;
        recurringExpenseId: string | null;
        scope: string;
        status: string;
        title: string;
      }>;
      recurringExpenses: Array<{
        amountMinor: number;
        automaticGeneration: boolean;
        billingDay: number;
        categoryId: string;
        costType: string;
        currency: string;
        frequency: string;
        id: string;
        scope: string;
        startDate: string;
        status: string;
        title: string;
      }>;
    };

    expect(data.expenseCategories).toBeDefined();
    expect(data.recurringExpenses).toBeDefined();
    expect(data.expenses).toBeDefined();
    expect(data.expenseCategories.map(({ name }) => name)).toEqual(
      expectedExpenseCategories,
    );
    const categoryNames = new Map(
      data.expenseCategories.map(({ id, name }) => [id, name]),
    );

    expect(
      data.recurringExpenses.map((template) => ({
        amountMinor: template.amountMinor,
        automaticGeneration: template.automaticGeneration,
        billingDay: template.billingDay,
        category: categoryNames.get(template.categoryId),
        costType: template.costType,
        currency: template.currency,
        frequency: template.frequency,
        scope: template.scope,
        startDate: template.startDate,
        status: template.status,
        title: template.title,
      })),
    ).toEqual([
      {
        amountMinor: 2_000,
        automaticGeneration: true,
        billingDay: 5,
        category: "Software",
        costType: "fixed",
        currency: "USD",
        frequency: "monthly",
        scope: "business",
        startDate: DEMO_SEED_REFERENCE_DATE,
        status: "active",
        title: "Vercel",
      },
      {
        amountMinor: 4_500_000,
        automaticGeneration: true,
        billingDay: 10,
        category: "Servicios",
        costType: "fixed",
        currency: "ARS",
        frequency: "monthly",
        scope: "personal",
        startDate: DEMO_SEED_REFERENCE_DATE,
        status: "active",
        title: "Internet",
      },
      {
        amountMinor: 15_000_000,
        automaticGeneration: true,
        billingDay: 15,
        category: "Marketing",
        costType: "variable",
        currency: "ARS",
        frequency: "monthly",
        scope: "business",
        startDate: DEMO_SEED_REFERENCE_DATE,
        status: "active",
        title: "Marketing",
      },
    ]);

    expect(
      data.expenses
        .filter(({ recurringExpenseId }) => recurringExpenseId === null)
        .map((expense) => ({
          amountMinor: expense.amountMinor,
          category: categoryNames.get(expense.categoryId),
          costType: expense.costType,
          currency: expense.currency,
          dueDate: expense.dueDate,
          generatedAutomatically: expense.generatedAutomatically,
          paidDate: expense.paidDate,
          scope: expense.scope,
          status: expense.status,
          title: expense.title,
        })),
    ).toEqual([
      {
        amountMinor: 4_000_000,
        category: "Comida",
        costType: "variable",
        currency: "ARS",
        dueDate: "2026-08-30",
        generatedAutomatically: false,
        paidDate: "2026-08-30",
        scope: "partner",
        status: "paid",
        title: "Cena",
      },
      {
        amountMinor: 90_000,
        category: "Equipamiento",
        costType: "variable",
        currency: "USD",
        dueDate: "2026-09-30",
        generatedAutomatically: false,
        paidDate: null,
        scope: "business",
        status: "planned",
        title: "Notebook",
      },
    ]);

    const generated = data.expenses.filter(
      ({ recurringExpenseId }) => recurringExpenseId !== null,
    );
    expect(generated).toHaveLength(9);
    expect(
      generated.map(({ dueDate, status, title }) => ({
        dueDate,
        status,
        title,
      })),
    ).toEqual([
      { dueDate: "2026-09-05", status: "pending", title: "Vercel" },
      { dueDate: "2026-10-05", status: "pending", title: "Vercel" },
      { dueDate: "2026-11-05", status: "pending", title: "Vercel" },
      { dueDate: "2026-09-10", status: "pending", title: "Internet" },
      { dueDate: "2026-10-10", status: "pending", title: "Internet" },
      { dueDate: "2026-11-10", status: "pending", title: "Internet" },
      { dueDate: "2026-09-15", status: "pending", title: "Marketing" },
      { dueDate: "2026-10-15", status: "pending", title: "Marketing" },
      { dueDate: "2026-11-15", status: "pending", title: "Marketing" },
    ]);
  });
});
