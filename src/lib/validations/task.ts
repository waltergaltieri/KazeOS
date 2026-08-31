import { z } from "zod";

import { validateCommercialDate } from "@/lib/domain/commercial-date";

const optionalText = (max: number) => z.preprocess((value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  const normalized = value.trim();
  return normalized ? normalized : null;
}, z.string().max(max).nullable());

const optionalUuid = z.preprocess((value) => value === "" || value === null || value === undefined ? null : value, z.string().uuid().nullable());
const commercialDate = z.string().superRefine((value, context) => {
  try { validateCommercialDate(value); }
  catch { context.addIssue({ code: "custom", message: "Ingresá una fecha válida." }); }
});
const optionalCommercialDate = z.preprocess((value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  return value.trim() || null;
}, commercialDate.nullable());
const checkbox = z.preprocess((value) => value === "on" || value === "true" || value === true, z.boolean());

export const taskIdSchema = z.string().uuid("La tarea no es válida.");
export const taskPrioritySchema = z.enum(["low", "medium", "high"]);
export const taskStatusSchema = z.enum(["pending", "completed"]);
export const taskRecurrenceSchema = z.enum(["monthly"]);

export const taskFormSchema = z.object({
  clientId: optionalUuid,
  title: z.string().trim().min(1, "El título es obligatorio.").max(200),
  description: optionalText(2_000),
  dueDate: optionalCommercialDate,
  priority: taskPrioritySchema,
  status: taskStatusSchema.default("pending"),
  recurring: checkbox,
  recurrence: z.preprocess((value) => value === "" || value === null || value === undefined ? null : value, taskRecurrenceSchema.nullable()),
}).strict().superRefine((task, context) => {
  if (task.recurring && task.dueDate === null) context.addIssue({ code: "custom", path: ["dueDate"], message: "Una tarea recurrente necesita fecha." });
  if (task.recurring !== (task.recurrence === "monthly")) context.addIssue({ code: "custom", path: ["recurrence"], message: "La recurrencia debe ser mensual." });
});

const supportedFilters = ["all", "today", "upcoming", "overdue", "completed", "undated"] as const;
export const taskFiltersSchema = z.object({
  status: z.enum(supportedFilters).default("all"),
  search: z.string().trim().max(160).optional().transform((value) => value || undefined),
  q: z.string().trim().max(160).optional(),
  clientId: z.string().uuid().optional(),
  priority: taskPrioritySchema.optional(),
}).transform(({ q, search, ...filters }) => ({ ...filters, search: search ?? (q?.trim() || undefined) }));

export type TaskFormValues = z.infer<typeof taskFormSchema>;
export type TaskFilters = z.infer<typeof taskFiltersSchema>;
