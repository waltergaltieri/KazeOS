import { z } from "zod";

const optionalText = (max: number) =>
  z.preprocess(
    (value) => {
      if (value === null) return undefined;
      if (typeof value !== "string") return value;
      const normalized = value.trim();
      return normalized.length === 0 ? undefined : normalized;
    },
    z.string().max(max).optional(),
  );

const optionalEmail = z.preprocess(
  (value) => {
    if (value === null) return undefined;
    if (typeof value !== "string") return value;
    const normalized = value.trim().toLowerCase();
    return normalized.length === 0 ? undefined : normalized;
  },
  z.string().email("Ingresá un email válido.").max(254).optional(),
);

const optionalWebsite = z.preprocess(
  (value) => {
    if (value === null) return undefined;
    if (typeof value !== "string") return value;
    const normalized = value.trim();
    return normalized.length === 0 ? undefined : normalized;
  },
  z
    .string()
    .url("Ingresá una URL válida.")
    .max(2_048)
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "La URL debe comenzar con http:// o https://.",
    })
    .optional(),
);

export const clientStatusSchema = z.enum(["active", "paused", "archived"]);

export const clientFormSchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(1, "El nombre es obligatorio.")
      .max(120),
    lastName: optionalText(120),
    company: optionalText(200),
    email: optionalEmail,
    phone: optionalText(50),
    whatsapp: optionalText(50),
    taxId: optionalText(64),
    website: optionalWebsite,
    address: optionalText(500),
    notes: optionalText(5_000),
    status: clientStatusSchema.default("active"),
  })
  .strict();

export const clientIdSchema = z.string().uuid("El cliente no es válido.");

export const clientFilterSchema = z.enum([
  "all",
  "active",
  "paused",
  "archived",
  "debt",
  "current",
]);

export const clientFiltersSchema = z
  .object({
    search: optionalText(100),
    filter: clientFilterSchema.default("all"),
  })
  .strict();

export type ClientFormValues = z.infer<typeof clientFormSchema>;
export type ClientFilter = z.infer<typeof clientFilterSchema>;
export type ClientFilters = z.infer<typeof clientFiltersSchema>;
