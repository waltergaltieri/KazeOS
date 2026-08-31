import { z } from "zod";

import { validateCommercialDate } from "@/lib/domain/commercial-date";
import { parseMoneyInput } from "@/lib/domain/money";

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

export const commercialDateSchema = z.string().superRefine((value, context) => {
  try { validateCommercialDate(value); } catch { context.addIssue({ code: "custom", message: "Ingresá una fecha válida." }); }
});
const optionalDate = z.preprocess((value) => value === "" || value == null ? undefined : value, commercialDateSchema.optional());
const optionalUuid = z.preprocess((value) => value === "" || value == null ? undefined : value, z.string().uuid().optional());
const positiveMoney = z.string().trim().superRefine((value, context) => {
  try { if (parseMoneyInput(value) <= 0) throw new RangeError(); } catch { context.addIssue({ code: "custom", message: "Ingresá un monto positivo válido." }); }
}).transform((value) => parseMoneyInput(value));

export const chargeIdSchema = z.string().uuid("El cobro no es válido.");
export const chargeCurrencySchema = z.enum(["USD", "ARS"]);
export const chargeDisplayStatusSchema = z.enum(["all", "current_month", "upcoming", "due_today", "overdue", "partial", "paid"]);

export const chargeFormSchema = z.object({
  clientId: z.string().uuid("El cliente no es válido."),
  description: z.string().trim().min(1, "La descripción es obligatoria.").max(500),
  amount: positiveMoney,
  currency: chargeCurrencySchema,
  dueDate: commercialDateSchema,
  notes: optionalText(2_000),
}).strict().transform(({ amount: amountMinor, ...values }) => ({ ...values, amountMinor }));

export const chargeFiltersSchema = z.object({
  status: chargeDisplayStatusSchema.default("all"),
  clientId: optionalUuid,
  serviceId: optionalUuid,
  currency: z.preprocess((value) => value === "" || value == null ? undefined : value, chargeCurrencySchema.optional()),
  from: optionalDate,
  to: optionalDate,
  search: optionalFilterText(100),
}).strict().superRefine((value, context) => {
  if (value.from && value.to && value.from > value.to) context.addIssue({ code: "custom", path: ["to"], message: "La fecha final no puede ser anterior a la inicial." });
});

export type ChargeFormValues = z.infer<typeof chargeFormSchema>;
export type ChargeFilters = z.infer<typeof chargeFiltersSchema>;
