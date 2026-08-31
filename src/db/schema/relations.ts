import { relations } from "drizzle-orm";

import { charges } from "./charges";
import { clientNotes } from "./client-notes";
import { clients } from "./clients";
import { payments } from "./payments";
import { services } from "./services";
import { tasks } from "./tasks";

export const clientsRelations = relations(clients, ({ many }) => ({
  services: many(services),
  charges: many(charges),
  payments: many(payments),
  tasks: many(tasks),
  notes: many(clientNotes),
}));

export const servicesRelations = relations(services, ({ one, many }) => ({
  client: one(clients, {
    fields: [services.clientId],
    references: [clients.id],
  }),
  charges: many(charges),
}));

export const chargesRelations = relations(charges, ({ one, many }) => ({
  client: one(clients, {
    fields: [charges.clientId],
    references: [clients.id],
  }),
  service: one(services, {
    fields: [charges.serviceId],
    references: [services.id],
  }),
  payments: many(payments),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  client: one(clients, {
    fields: [payments.clientId],
    references: [clients.id],
  }),
  charge: one(charges, {
    fields: [payments.chargeId],
    references: [charges.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  client: one(clients, {
    fields: [tasks.clientId],
    references: [clients.id],
  }),
  parent: one(tasks, {
    fields: [tasks.parentId],
    references: [tasks.id],
    relationName: "task_recurrence",
  }),
  occurrences: many(tasks, { relationName: "task_recurrence" }),
}));

export const clientNotesRelations = relations(clientNotes, ({ one }) => ({
  client: one(clients, {
    fields: [clientNotes.clientId],
    references: [clients.id],
  }),
}));
