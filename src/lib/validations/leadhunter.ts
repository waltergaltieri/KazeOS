import { z } from "zod";

import {
  campaignStrategySchema,
  leadHunterSourceSchema,
} from "@/lib/leadhunter/contracts";

export { leadHunterSourceSchema } from "@/lib/leadhunter/contracts";
export type { LeadHunterSource } from "@/lib/leadhunter/contracts";

const trimmedText = (minimum: number, maximum: number, message: string) =>
  z.string().trim().min(minimum, message).max(maximum);

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Ingresá una hora válida.");

const weekdaySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

const nonEmptyWeekdays = z
  .array(weekdaySchema)
  .min(1, "Elegí al menos un día.")
  .max(7)
  .transform((days) => [...new Set(days)]);

const criterionSchema = z.string().trim().min(1).max(240);

const normalizedCriterion = (criterion: string) =>
  criterion.trim().replace(/\s+/g, " ").toLocaleLowerCase();

const criteriaSchema = z
  .array(criterionSchema)
  .max(30)
  .default([])
  .transform((criteria) => {
    const signals = new Set<string>();
    return criteria.filter((criterion) => {
      const signal = normalizedCriterion(criterion);
      if (signals.has(signal)) return false;
      signals.add(signal);
      return true;
    });
  });

export const campaignStatusSchema = z.enum([
  "draft",
  "active",
  "paused",
  "archived",
]);

export const campaignFormSchema = z
  .object({
    name: trimmedText(1, 160, "El nombre es obligatorio."),
    objective: trimmedText(10, 2_000, "Describí qué negocios querés encontrar."),
    serviceFocus: z.enum([
      "custom_management",
      "web",
      "ecommerce",
      "ai_bots",
      "automation",
    ]),
    countries: z
      .array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/))
      .min(1, "Elegí al menos un país.")
      .max(20)
      .transform((countries) => [...new Set(countries)]),
    sources: z
      .array(leadHunterSourceSchema)
      .min(1, "Elegí al menos una fuente.")
      .transform((sources) => [...new Set(sources)]),
    positiveCriteria: criteriaSchema,
    negativeCriteria: criteriaSchema,
    strategy: campaignStrategySchema.optional(),
    searchDays: nonEmptyWeekdays,
    searchTime: timeSchema,
    sendDays: nonEmptyWeekdays,
    sendStart: timeSchema,
    sendEnd: timeSchema,
    timezone: z.string().trim().refine(
      (value) => {
        try {
          new Intl.DateTimeFormat("es", { timeZone: value }).format();
          return true;
        } catch {
          return false;
        }
      },
      "Elegí una zona horaria válida.",
    ),
    dailyLeadLimit: z.coerce.number().int().min(1).max(1_000),
    dailyEmailLimit: z.coerce.number().int().min(1).max(1_000),
    sequenceSteps: z
      .array(
        z.object({
          delayDays: z.coerce.number().int().min(0).max(365),
          subjectInstruction: trimmedText(
            1,
            300,
            "Indicá cómo redactar el asunto.",
          ),
          bodyInstruction: trimmedText(
            1,
            2_000,
            "Indicá qué debe comunicar el correo.",
          ),
        }),
      )
      .min(1, "Agregá al menos un correo a la secuencia.")
      .max(12),
  })
  .strict()
  .superRefine((campaign, context) => {
    if (campaign.sendEnd <= campaign.sendStart) {
      context.addIssue({
        code: "custom",
        path: ["sendEnd"],
        message: "La hora de fin debe ser posterior a la hora de inicio.",
      });
    }

    if (campaign.sequenceSteps[0]?.delayDays !== 0) {
      context.addIssue({
        code: "custom",
        path: ["sequenceSteps", 0, "delayDays"],
        message: "El primer correo debe comenzar sin demora.",
      });
    }

    const positiveSignals = new Set(
      campaign.positiveCriteria.map(normalizedCriterion),
    );
    if (campaign.negativeCriteria.some(
      (criterion) => positiveSignals.has(normalizedCriterion(criterion)),
    )) {
      context.addIssue({
        code: "custom",
        path: ["negativeCriteria"],
        message: "Un criterio no puede ser positivo y negativo a la vez.",
      });
    }

    if (campaign.strategy) {
      const combinedSignals = new Set(
        campaign.strategy.qualification.rules.map((rule) =>
          normalizedCriterion(rule.criterion)),
      );
      campaign.positiveCriteria.forEach((criterion) =>
        combinedSignals.add(normalizedCriterion(criterion)));
      campaign.negativeCriteria.forEach((criterion) =>
        combinedSignals.add(normalizedCriterion(criterion)));

      if (combinedSignals.size > 100) {
        context.addIssue({
          code: "custom",
          path: ["strategy", "qualification", "rules"],
          message: "La estrategia combinada no puede superar 100 criterios únicos.",
        });
      }
    }
  });

export const campaignStatusTransitionSchema = z
  .object({
    currentStatus: campaignStatusSchema,
    nextStatus: campaignStatusSchema,
    automationMode: z.enum(["drafts", "automatic"]),
    mailboxId: z.string().uuid().nullable(),
  })
  .strict()
  .superRefine((transition, context) => {
    if (transition.currentStatus === "archived" && transition.nextStatus !== "archived") {
      context.addIssue({
        code: "custom",
        path: ["nextStatus"],
        message: "Una campaña archivada no puede reactivarse.",
      });
    }

    if (
      transition.nextStatus === "active" &&
      transition.automationMode === "automatic" &&
      !transition.mailboxId
    ) {
      context.addIssue({
        code: "custom",
        path: ["mailboxId"],
        message: "Conectá una cuenta de correo antes de activar envíos automáticos.",
      });
    }
  });

export const campaignIdSchema = z.string().uuid("La campaña no es válida.");
export const leadIdSchema = z.string().uuid("El prospecto no es válido.");

const optionalNullText = (maximum: number) => z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return value;
    const normalized = value.trim();
    return normalized.length ? normalized : null;
  },
  z.string().max(maximum).nullable(),
);

const optionalNullEmail = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return value;
    const normalized = value.trim().toLowerCase();
    return normalized.length ? normalized : null;
  },
  z.string().email("Ingresá un email válido.").max(254).nullable(),
);

const optionalNullUrl = z.preprocess(
  (value) => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return value;
    const normalized = value.trim();
    if (!normalized.length) return null;
    return /^[a-z][a-z\d+.-]*:/i.test(normalized)
      ? normalized
      : `https://${normalized}`;
  },
  z
    .string()
    .url("Ingresá una URL válida.")
    .max(2_048)
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "La URL debe usar http o https.",
    })
    .transform((value) => new URL(value).toString())
    .nullable(),
);

export const leadFormSchema = z
  .object({
    campaignId: campaignIdSchema,
    name: trimmedText(1, 200, "El nombre del negocio es obligatorio."),
    countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
    city: optionalNullText(160),
    website: optionalNullUrl,
    description: optionalNullText(3_000),
    firstName: optionalNullText(120),
    lastName: optionalNullText(120),
    role: optionalNullText(160),
    email: optionalNullEmail,
    phone: optionalNullText(60),
    sourceType: leadHunterSourceSchema,
    sourceUrl: optionalNullUrl,
  })
  .strict();

export type CampaignFormValues = z.infer<typeof campaignFormSchema>;
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;
export type LeadFormValues = z.infer<typeof leadFormSchema>;
