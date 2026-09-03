import { createHash } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import { addCommercialPeriod } from "../lib/domain/commercial-date";
import { buildRecurringPeriods } from "../lib/domain/recurrence";
import { DEFAULT_EXPENSE_CATEGORIES } from "../lib/constants/default-expense-categories";
import * as schema from "./schema";
import {
  charges,
  clientNotes,
  clients,
  expenseCategories,
  expenses,
  payments,
  recurringExpenses,
  services,
  tasks,
} from "./schema";

export const DEMO_SEED_REFERENCE_DATE = "2026-08-31";

function addSeedDays(referenceDate: string, days: number): string {
  const [year, month, day] = referenceDate.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));

  return result.toISOString().slice(0, 10);
}

function stableUuid(ownerId: string, key: string): string {
  const bytes = createHash("sha1").update(`kazeos-demo:${ownerId}:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createDemoSeedData(ownerId: string) {
  const id = (key: string) => stableUuid(ownerId, key);
  const clientIds = {
    norte: id("client-estudio-norte"), demo: id("client-empresa-demo"), global: id("client-global"),
    tech: id("client-tech-solutions"), startup: id("client-startup-labs"),
  };
  const serviceIds = {
    hosting: id("service-hosting"), design: id("service-design"), consulting: id("service-consulting"),
    support: id("service-support"), website: id("service-website"),
  };
  const chargeIds = {
    paid: id("charge-paid"), partial: id("charge-partial"), overdue: id("charge-overdue"),
    pendingArs: id("charge-pending-ars"), pendingUsd: id("charge-pending-usd"),
  };
  const categoryIds = Object.fromEntries(
    DEFAULT_EXPENSE_CATEGORIES.map((name) => [
      name,
      id(`expense-category-${name}`),
    ]),
  ) as Record<(typeof DEFAULT_EXPENSE_CATEGORIES)[number], string>;
  const recurringExpenseIds = {
    vercel: id("recurring-expense-vercel"),
    internet: id("recurring-expense-internet"),
    marketing: id("recurring-expense-marketing"),
  };
  const auditDate = new Date(`${DEMO_SEED_REFERENCE_DATE}T12:00:00.000Z`);

  const clientsData = [
    { id: clientIds.norte, ownerId, firstName: "Estudio Norte", company: "Estudio Norte", email: "contacto@estudionorte.example", status: "active" as const, joinedAt: "2026-02-10", createdAt: auditDate, updatedAt: auditDate },
    { id: clientIds.demo, ownerId, firstName: "Empresa Demo", company: "Empresa Demo", email: "hola@empresademo.example", status: "active" as const, joinedAt: "2026-03-05", createdAt: auditDate, updatedAt: auditDate },
    { id: clientIds.global, ownerId, firstName: "Cliente Global", company: "Cliente Global", email: "admin@clienteglobal.example", status: "active" as const, joinedAt: "2026-04-12", createdAt: auditDate, updatedAt: auditDate },
    { id: clientIds.tech, ownerId, firstName: "Tech Solutions", company: "Tech Solutions", email: "ops@techsolutions.example", status: "active" as const, joinedAt: "2026-05-18", createdAt: auditDate, updatedAt: auditDate },
    { id: clientIds.startup, ownerId, firstName: "StartUp Labs", company: "StartUp Labs", email: "founders@startuplabs.example", status: "active" as const, joinedAt: "2026-06-21", createdAt: auditDate, updatedAt: auditDate },
  ];

  const servicesData = [
    { id: serviceIds.hosting, ownerId, clientId: clientIds.norte, name: "Hosting administrado", description: "Hosting y mantenimiento mensual", billingType: "recurring" as const, amountMinor: 125_000, currency: "USD" as const, billingFrequency: "monthly" as const, billingDay: 5, startDate: "2026-03-01", status: "active" as const, automaticChargeGeneration: true, createdAt: auditDate, updatedAt: auditDate },
    { id: serviceIds.design, ownerId, clientId: clientIds.demo, name: "Diseño mensual", billingType: "recurring" as const, amountMinor: 300_000, currency: "ARS" as const, billingFrequency: "monthly" as const, billingDay: 10, startDate: "2026-04-01", status: "active" as const, automaticChargeGeneration: true, createdAt: auditDate, updatedAt: auditDate },
    { id: serviceIds.consulting, ownerId, clientId: clientIds.global, name: "Consultoría trimestral", billingType: "recurring" as const, amountMinor: 240_000, currency: "USD" as const, billingFrequency: "quarterly" as const, billingDay: 15, startDate: "2026-01-01", status: "active" as const, automaticChargeGeneration: true, createdAt: auditDate, updatedAt: auditDate },
    { id: serviceIds.support, ownerId, clientId: clientIds.tech, name: "Soporte operativo", billingType: "recurring" as const, amountMinor: 850_000, currency: "ARS" as const, billingFrequency: "monthly" as const, billingDay: 20, startDate: "2026-05-01", status: "active" as const, automaticChargeGeneration: true, createdAt: auditDate, updatedAt: auditDate },
    { id: serviceIds.website, ownerId, clientId: clientIds.startup, name: "Sitio institucional", billingType: "one_time" as const, amountMinor: 180_000, currency: "USD" as const, billingFrequency: "one_time" as const, billingDay: null, startDate: "2026-07-01", status: "active" as const, automaticChargeGeneration: false, createdAt: auditDate, updatedAt: auditDate },
  ];

  const chargesData = [
    { id: chargeIds.paid, ownerId, clientId: clientIds.norte, serviceId: serviceIds.hosting, description: "Hosting agosto", amountMinor: 125_000, currency: "USD" as const, dueDate: "2026-08-05", generatedAutomatically: false, createdAt: auditDate, updatedAt: auditDate },
    { id: chargeIds.partial, ownerId, clientId: clientIds.demo, serviceId: serviceIds.design, description: "Diseño agosto", amountMinor: 300_000, currency: "ARS" as const, dueDate: "2026-08-20", generatedAutomatically: false, createdAt: auditDate, updatedAt: auditDate },
    { id: chargeIds.overdue, ownerId, clientId: clientIds.global, serviceId: serviceIds.consulting, description: "Consultoría vencida", amountMinor: 240_000, currency: "USD" as const, dueDate: "2026-08-25", generatedAutomatically: false, createdAt: auditDate, updatedAt: auditDate },
    { id: chargeIds.pendingArs, ownerId, clientId: clientIds.tech, serviceId: serviceIds.support, description: "Soporte septiembre", amountMinor: 850_000, currency: "ARS" as const, dueDate: "2026-09-03", generatedAutomatically: false, createdAt: auditDate, updatedAt: auditDate },
    { id: chargeIds.pendingUsd, ownerId, clientId: clientIds.startup, serviceId: serviceIds.website, description: "Saldo sitio institucional", amountMinor: 180_000, currency: "USD" as const, dueDate: "2026-09-07", generatedAutomatically: false, createdAt: auditDate, updatedAt: auditDate },
  ];

  const paymentsData = [
    { id: id("payment-paid-first"), ownerId, clientId: clientIds.norte, chargeId: chargeIds.paid, amountMinor: 50_000, currency: "USD" as const, paymentDate: "2026-08-08", paymentMethod: "bank_transfer" as const, reference: "DEMO-USD-01", createdAt: auditDate, updatedAt: auditDate },
    { id: id("payment-paid-second"), ownerId, clientId: clientIds.norte, chargeId: chargeIds.paid, amountMinor: 75_000, currency: "USD" as const, paymentDate: "2026-08-12", paymentMethod: "paypal" as const, reference: "DEMO-USD-02", createdAt: auditDate, updatedAt: auditDate },
    { id: id("payment-partial"), ownerId, clientId: clientIds.demo, chargeId: chargeIds.partial, amountMinor: 100_000, currency: "ARS" as const, paymentDate: "2026-08-22", paymentMethod: "mercadopago" as const, reference: "DEMO-ARS-01", createdAt: auditDate, updatedAt: auditDate },
  ];

  const tasksData = [
    { id: id("task-catalog"), ownerId, clientId: clientIds.norte, title: "Actualizar catálogo de productos", dueDate: "2026-08-31", priority: "high" as const, status: "pending" as const, recurring: false, createdAt: auditDate, updatedAt: auditDate },
    { id: id("task-domain"), ownerId, clientId: clientIds.demo, title: "Revisar dominio y SSL", dueDate: "2026-09-01", priority: "medium" as const, status: "pending" as const, recurring: false, createdAt: auditDate, updatedAt: auditDate },
    { id: id("task-report"), ownerId, clientId: clientIds.tech, title: "Enviar reporte mensual", dueDate: "2026-09-02", priority: "low" as const, status: "pending" as const, recurring: false, createdAt: auditDate, updatedAt: auditDate },
    { id: id("task-followup"), ownerId, clientId: clientIds.global, title: "Reunión de seguimiento", dueDate: "2026-08-28", priority: "medium" as const, status: "pending" as const, recurring: false, createdAt: auditDate, updatedAt: auditDate },
    { id: id("task-completed"), ownerId, clientId: clientIds.startup, title: "Configurar nuevo usuario", dueDate: "2026-08-29", priority: "high" as const, status: "completed" as const, completedAt: new Date("2026-08-29T18:00:00.000Z"), recurring: false, createdAt: auditDate, updatedAt: auditDate },
  ];

  const notesData = [
    { id: id("note-norte"), ownerId, clientId: clientIds.norte, content: "Prefiere recibir el resumen antes del día 5.", createdAt: new Date("2026-08-15T14:00:00.000Z"), updatedAt: new Date("2026-08-15T14:00:00.000Z") },
    { id: id("note-demo"), ownerId, clientId: clientIds.demo, content: "Confirmó la próxima revisión de marca.", createdAt: new Date("2026-08-20T14:00:00.000Z"), updatedAt: new Date("2026-08-20T14:00:00.000Z") },
    { id: id("note-global"), ownerId, clientId: clientIds.global, content: "Coordinar la reunión con el equipo regional.", createdAt: new Date("2026-08-25T14:00:00.000Z"), updatedAt: new Date("2026-08-25T14:00:00.000Z") },
  ];

  const expenseCategoriesData = DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
    active: true,
    createdAt: auditDate,
    icon: null,
    id: categoryIds[name],
    name,
    ownerId,
    updatedAt: auditDate,
  }));

  const recurringExpensesData = [
    {
      amountMinor: 2_000,
      automaticGeneration: true,
      billingDay: 5,
      categoryId: categoryIds.Software,
      costType: "fixed" as const,
      createdAt: auditDate,
      currency: "USD" as const,
      description: "Infraestructura de despliegue",
      endDate: null,
      frequency: "monthly" as const,
      id: recurringExpenseIds.vercel,
      notes: null,
      ownerId,
      paymentMethod: "credit_card" as const,
      scope: "business" as const,
      startDate: DEMO_SEED_REFERENCE_DATE,
      status: "active" as const,
      title: "Vercel",
      updatedAt: auditDate,
      vendor: "Vercel",
    },
    {
      amountMinor: 4_500_000,
      automaticGeneration: true,
      billingDay: 10,
      categoryId: categoryIds.Servicios,
      costType: "fixed" as const,
      createdAt: auditDate,
      currency: "ARS" as const,
      description: "Servicio de internet",
      endDate: null,
      frequency: "monthly" as const,
      id: recurringExpenseIds.internet,
      notes: null,
      ownerId,
      paymentMethod: "debit_card" as const,
      scope: "personal" as const,
      startDate: DEMO_SEED_REFERENCE_DATE,
      status: "active" as const,
      title: "Internet",
      updatedAt: auditDate,
      vendor: "Proveedor de internet",
    },
    {
      amountMinor: 15_000_000,
      automaticGeneration: true,
      billingDay: 15,
      categoryId: categoryIds.Marketing,
      costType: "variable" as const,
      createdAt: auditDate,
      currency: "ARS" as const,
      description: "Campañas y promoción",
      endDate: null,
      frequency: "monthly" as const,
      id: recurringExpenseIds.marketing,
      notes: null,
      ownerId,
      paymentMethod: "bank_transfer" as const,
      scope: "business" as const,
      startDate: DEMO_SEED_REFERENCE_DATE,
      status: "active" as const,
      title: "Marketing",
      updatedAt: auditDate,
      vendor: "Agencia de marketing",
    },
  ];

  const manualExpensesData = [
    {
      amountMinor: 4_000_000,
      categoryId: categoryIds.Comida,
      costType: "variable" as const,
      createdAt: auditDate,
      currency: "ARS" as const,
      description: "Cena compartida",
      dueDate: addSeedDays(DEMO_SEED_REFERENCE_DATE, -1),
      generatedAutomatically: false,
      id: id("expense-cena"),
      notes: null,
      ownerId,
      paidDate: addSeedDays(DEMO_SEED_REFERENCE_DATE, -1),
      paymentMethod: "credit_card" as const,
      periodKey: null,
      recurringExpenseId: null,
      scope: "partner" as const,
      status: "paid" as const,
      title: "Cena",
      updatedAt: auditDate,
      vendor: "Restaurante",
    },
    {
      amountMinor: 90_000,
      categoryId: categoryIds.Equipamiento,
      costType: "variable" as const,
      createdAt: auditDate,
      currency: "USD" as const,
      description: "Renovación de equipo de trabajo",
      dueDate: addCommercialPeriod(
        DEMO_SEED_REFERENCE_DATE,
        "monthly",
      ),
      generatedAutomatically: false,
      id: id("expense-notebook"),
      notes: null,
      ownerId,
      paidDate: null,
      paymentMethod: null,
      periodKey: null,
      recurringExpenseId: null,
      scope: "business" as const,
      status: "planned" as const,
      title: "Notebook",
      updatedAt: auditDate,
      vendor: null,
    },
  ];

  const recurringExpenseOccurrencesData = recurringExpensesData.flatMap(
    (template) =>
      buildRecurringPeriods(
        {
          amountMinor: template.amountMinor,
          billingDay: template.billingDay,
          endDate: template.endDate,
          frequency: template.frequency,
          label: template.title,
          startDate: template.startDate,
        },
        DEMO_SEED_REFERENCE_DATE,
      ).map((candidate) => ({
        amountMinor: candidate.amountMinor,
        categoryId: template.categoryId,
        costType: template.costType,
        createdAt: auditDate,
        currency: template.currency,
        description: template.description,
        dueDate: candidate.dueDate,
        generatedAutomatically: true,
        id: id(
          `expense-occurrence-${template.title}-${candidate.periodKey}`,
        ),
        notes: template.notes,
        ownerId,
        paidDate: null,
        paymentMethod: template.paymentMethod,
        periodKey: candidate.periodKey,
        recurringExpenseId: template.id,
        scope: template.scope,
        status: "pending" as const,
        title: template.title,
        updatedAt: auditDate,
        vendor: template.vendor,
      })),
  );

  return {
    referenceDate: DEMO_SEED_REFERENCE_DATE,
    clients: clientsData,
    services: servicesData,
    charges: chargesData,
    payments: paymentsData,
    tasks: tasksData,
    notes: notesData,
    expenseCategories: expenseCategoriesData,
    recurringExpenses: recurringExpensesData,
    expenses: [...manualExpensesData, ...recurringExpenseOccurrencesData],
  };
}

type SeedDatabase = PostgresJsDatabase<typeof schema>;

export async function seedDemoData(database: SeedDatabase, ownerId: string) {
  const data = createDemoSeedData(ownerId);
  for (const row of data.clients) await database.insert(clients).values(row).onConflictDoUpdate({ target: clients.id, set: row });
  for (const row of data.services) await database.insert(services).values(row).onConflictDoUpdate({ target: services.id, set: row });
  for (const row of data.charges) {
    const updated = await database.update(charges).set(row).where(and(eq(charges.id, row.id), eq(charges.ownerId, ownerId))).returning({ id: charges.id });
    if (updated.length === 0) await database.insert(charges).values(row);
  }
  for (const row of data.payments) await database.insert(payments).values(row).onConflictDoUpdate({ target: payments.id, set: row });
  for (const row of data.tasks) await database.insert(tasks).values(row).onConflictDoUpdate({ target: tasks.id, set: row });
  for (const row of data.notes) await database.insert(clientNotes).values(row).onConflictDoUpdate({ target: clientNotes.id, set: row });
  await database.insert(expenseCategories).values(data.expenseCategories).onConflictDoUpdate({
    target: expenseCategories.id,
    set: {
      active: sql`excluded.active`,
      icon: sql`excluded.icon`,
      name: sql`excluded.name`,
      updatedAt: sql`excluded.updated_at`,
    },
  });
  await database.insert(recurringExpenses).values(data.recurringExpenses).onConflictDoUpdate({
    target: recurringExpenses.id,
    set: {
      amountMinor: sql`excluded.amount_minor`,
      automaticGeneration: sql`excluded.automatic_generation`,
      billingDay: sql`excluded.billing_day`,
      categoryId: sql`excluded.category_id`,
      costType: sql`excluded.cost_type`,
      currency: sql`excluded.currency`,
      description: sql`excluded.description`,
      endDate: sql`excluded.end_date`,
      frequency: sql`excluded.frequency`,
      notes: sql`excluded.notes`,
      paymentMethod: sql`excluded.payment_method`,
      scope: sql`excluded.scope`,
      startDate: sql`excluded.start_date`,
      status: sql`excluded.status`,
      title: sql`excluded.title`,
      updatedAt: sql`excluded.updated_at`,
      vendor: sql`excluded.vendor`,
    },
  });
  const manualExpenses = data.expenses.filter(
    (row) => row.recurringExpenseId === null,
  );
  const recurringExpenseOccurrences = data.expenses.filter(
    (row) => row.recurringExpenseId !== null,
  );
  await database.insert(expenses).values(manualExpenses).onConflictDoUpdate({
    target: expenses.id,
    set: {
      amountMinor: sql`excluded.amount_minor`,
      categoryId: sql`excluded.category_id`,
      costType: sql`excluded.cost_type`,
      currency: sql`excluded.currency`,
      description: sql`excluded.description`,
      dueDate: sql`excluded.due_date`,
      generatedAutomatically: sql`excluded.generated_automatically`,
      notes: sql`excluded.notes`,
      paidDate: sql`excluded.paid_date`,
      paymentMethod: sql`excluded.payment_method`,
      scope: sql`excluded.scope`,
      status: sql`excluded.status`,
      title: sql`excluded.title`,
      updatedAt: sql`excluded.updated_at`,
      vendor: sql`excluded.vendor`,
    },
  });
  await database
    .insert(expenses)
    .values(recurringExpenseOccurrences)
    .onConflictDoNothing({
      target: [expenses.recurringExpenseId, expenses.periodKey],
      where: sql`${expenses.recurringExpenseId} is not null and ${expenses.periodKey} is not null`,
    });
  return { clients: data.clients.length, services: data.services.length, charges: data.charges.length, payments: data.payments.length, tasks: data.tasks.length, notes: data.notes.length, expenseCategories: data.expenseCategories.length, recurringExpenses: data.recurringExpenses.length, expenses: data.expenses.length };
}
