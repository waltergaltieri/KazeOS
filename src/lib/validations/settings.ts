import { z } from "zod";

const optionalText = (max: number) => z.preprocess((value) => {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  return value.trim() || null;
}, z.string().max(max).nullable());

export const supportedTimezones = ["America/Argentina/Buenos_Aires"] as const;
export const supportedLocales = ["es-AR"] as const;

export const profileSettingsSchema = z.object({
  fullName: z.string().trim().min(1, "El nombre es obligatorio.").max(160),
}).strict();

export const businessSettingsSchema = z.object({
  primaryCurrency: z.enum(["USD", "ARS"]),
  timezone: z.enum(supportedTimezones),
  locale: z.enum(supportedLocales),
  businessName: optionalText(200),
  businessInfo: optionalText(2_000),
}).strict();

export type ProfileSettingsValues = z.infer<typeof profileSettingsSchema>;
export type BusinessSettingsValues = z.infer<typeof businessSettingsSchema>;
