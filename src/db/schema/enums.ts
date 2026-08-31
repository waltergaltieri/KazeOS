import { pgEnum } from "drizzle-orm/pg-core";

export const currencyEnum = pgEnum("currency", ["USD", "ARS"]);

export const clientStatusEnum = pgEnum("client_status", [
  "active",
  "paused",
  "archived",
]);

export const billingTypeEnum = pgEnum("billing_type", [
  "recurring",
  "one_time",
]);

export const billingFrequencyEnum = pgEnum("billing_frequency", [
  "monthly",
  "quarterly",
  "yearly",
  "one_time",
]);

export const serviceStatusEnum = pgEnum("service_status", [
  "active",
  "paused",
  "cancelled",
]);

export const chargeStatusEnum = pgEnum("charge_status", [
  "pending",
  "partial",
  "paid",
  "cancelled",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "bank_transfer",
  "cash",
  "mercadopago",
  "paypal",
  "payoneer",
  "stripe",
  "crypto",
  "other",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "medium",
  "high",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "completed",
]);

export const taskRecurrenceEnum = pgEnum("task_recurrence", ["monthly"]);
