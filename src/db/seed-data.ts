import { createHash } from "node:crypto";

import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "./schema";
import { charges, clientNotes, clients, payments, services, tasks } from "./schema";

export const DEMO_SEED_REFERENCE_DATE = "2026-08-31";

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
  const auditDate = new Date("2026-08-31T12:00:00.000Z");

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

  return { referenceDate: DEMO_SEED_REFERENCE_DATE, clients: clientsData, services: servicesData, charges: chargesData, payments: paymentsData, tasks: tasksData, notes: notesData };
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
  return { clients: data.clients.length, services: data.services.length, charges: data.charges.length, payments: data.payments.length, tasks: data.tasks.length, notes: data.notes.length };
}
