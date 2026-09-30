import { z } from "zod";

const nonBlankText = (maximum: number) => z.string().trim().min(1).max(maximum);

const uniqueTextArray = (itemMaximum: number, arrayMaximum: number) => z
  .array(nonBlankText(itemMaximum))
  .max(arrayMaximum)
  .transform((values) => [...new Set(values)]);

const httpUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2_048)
  .refine((value) => /^https?:\/\//i.test(value), {
    message: "La URL debe usar http o https.",
  });

export const leadHunterSourceSchema = z.enum([
  "web_search",
  "directories",
  "instagram",
  "linkedin",
  "csv",
  "manual",
]);

export const websiteGateStateSchema = z.enum([
  "NO_WEBSITE",
  "BAD_WEBSITE",
  "GOOD_ENOUGH_WEBSITE",
  "UNVERIFIED",
]);

export const messageSectionSchema = z.enum([
  "opening",
  "introduction",
  "business_understanding",
  "primary_opportunity",
  "operations_transition",
  "secondary_opportunity",
  "commercial_model",
  "cta",
  "signature",
]);

export const discoveryStrategySchema = z
  .object({
    countries: z
      .array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/))
      .min(1)
      .max(20)
      .transform((countries) => [...new Set(countries)]),
    regions: uniqueTextArray(160, 100),
    industries: uniqueTextArray(160, 100),
    queries: uniqueTextArray(500, 200).pipe(z.array(z.string()).min(1)),
    sources: z
      .array(leadHunterSourceSchema)
      .min(1)
      .transform((sources) => [...new Set(sources)]),
    seedUrls: z
      .array(httpUrlSchema)
      .max(100)
      .transform((urls) => [...new Set(urls)]),
  })
  .strict();

export const researchQuestionSchema = z
  .object({
    key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,79}$/),
    prompt: nonBlankText(1_000),
    required: z.boolean(),
  })
  .strict();

const websiteQualificationGateSchema = z
  .object({
    type: z.literal("website"),
    allowed: z
      .array(websiteGateStateSchema)
      .min(1)
      .transform((states) => [...new Set(states)]),
  })
  .strict();

const requiredFindingQualificationGateSchema = z
  .object({
    type: z.literal("required_finding"),
    field: nonBlankText(160),
    minimumConfidence: z.number().int().min(1).max(100),
  })
  .strict();

export const qualificationGateSchema = z.discriminatedUnion("type", [
  websiteQualificationGateSchema,
  requiredFindingQualificationGateSchema,
]);

export const qualificationRuleSchema = z
  .object({
    criterion: nonBlankText(240),
    weight: z.number().int().min(-100).max(100).refine((weight) => weight !== 0),
  })
  .strict();

const requiredMessageSectionsSchema = z
  .array(messageSectionSchema)
  .min(2)
  .transform((sections) => [...new Set(sections)])
  .superRefine((sections, context) => {
    for (const requiredSection of ["cta", "signature"] as const) {
      if (!sections.includes(requiredSection)) {
        context.addIssue({
          code: "custom",
          message: `La sección ${requiredSection} es obligatoria.`,
        });
      }
    }
  });

export const messagePolicySchema = z
  .object({
    language: z.enum(["es-AR", "en-US", "auto"]),
    tone: nonBlankText(240),
    minimumSpecificFacts: z.number().int().min(1).max(20),
    wordRange: z
      .object({
        minimum: z.number().int().min(1).max(2_000),
        maximum: z.number().int().min(1).max(2_000),
      })
      .strict()
      .refine((range) => range.maximum >= range.minimum, {
        path: ["maximum"],
        message: "El máximo de palabras debe ser mayor o igual al mínimo.",
      }),
    intro: nonBlankText(1_000),
    commercialModel: nonBlankText(1_000),
    cta: nonBlankText(500),
    signature: nonBlankText(500),
    requiredSections: requiredMessageSectionsSchema,
    restrictedPhrases: uniqueTextArray(240, 100),
  })
  .strict();

const researchStrategySchema = z
  .object({
    questions: z
      .array(researchQuestionSchema)
      .min(1)
      .max(100)
      .superRefine((questions, context) => {
        const keys = new Set<string>();
        const prompts = new Set<string>();

        questions.forEach((question, index) => {
          const key = question.key.toLocaleLowerCase();
          const prompt = question.prompt.toLocaleLowerCase();

          if (keys.has(key) || prompts.has(prompt)) {
            context.addIssue({
              code: "custom",
              path: [index],
              message: "Las preguntas de investigación no pueden repetirse.",
            });
          }

          keys.add(key);
          prompts.add(prompt);
        });
      }),
  })
  .strict();

const qualificationStrategySchema = z
  .object({
    gates: z.array(qualificationGateSchema).max(50),
    rules: z.array(qualificationRuleSchema).max(100),
  })
  .strict();

export const campaignStrategySchema = z
  .object({
    version: z.literal(1),
    discovery: discoveryStrategySchema,
    research: researchStrategySchema,
    qualification: qualificationStrategySchema,
    message: messagePolicySchema,
  })
  .strict();

export type LeadHunterSource = z.infer<typeof leadHunterSourceSchema>;
export type WebsiteGateState = z.infer<typeof websiteGateStateSchema>;
export type MessageSection = z.infer<typeof messageSectionSchema>;
export type DiscoveryStrategy = z.infer<typeof discoveryStrategySchema>;
export type ResearchQuestion = z.infer<typeof researchQuestionSchema>;
export type QualificationGate = z.infer<typeof qualificationGateSchema>;
export type QualificationRule = z.infer<typeof qualificationRuleSchema>;
export type MessagePolicy = z.infer<typeof messagePolicySchema>;
export type CampaignStrategy = z.infer<typeof campaignStrategySchema>;

interface CampaignStrategyDefaults {
  objective: string;
  serviceFocus: string;
  countries: string[];
  sources: LeadHunterSource[];
  positiveCriteria: string[];
  negativeCriteria: string[];
}

const serviceLabels: Record<string, string> = {
  custom_management: "un sistema de gestión a medida",
  web: "una mejora de su presencia web",
  ecommerce: "una mejora de su canal de ecommerce",
  ai_bots: "un asistente con inteligencia artificial",
  automation: "una automatización de sus procesos",
};

const maximumDiscoveryQueryLength = 500;

function discoveryQueryFromObjective(objective: string): string {
  const normalized = objective.trim().replace(/\s+/g, " ");

  if (normalized.length <= maximumDiscoveryQueryLength) {
    return normalized;
  }

  const wordBoundary = normalized.lastIndexOf(" ", maximumDiscoveryQueryLength);
  const end = wordBoundary > 0 ? wordBoundary : maximumDiscoveryQueryLength;

  return normalized.slice(0, end);
}

function messagePolicyForCountry(country: string): MessagePolicy {
  const useEnglish = country === "US";

  return {
    language: useEnglish ? "en-US" : "es-AR",
    tone: useEnglish
      ? "Direct, professional, and specific"
      : "Directo, profesional y específico",
    minimumSpecificFacts: 3,
    wordRange: { minimum: 120, maximum: 220 },
    intro: useEnglish
      ? "Introduce KazeCode briefly and explain the reason for reaching out."
      : "Presentar KazeCode brevemente y explicar el motivo del contacto.",
    commercialModel: useEnglish
      ? "Propose a concrete improvement with an agreed scope."
      : "Proponer una mejora concreta con un alcance acordado.",
    cta: useEnglish
      ? "Ask whether a brief conversation would be useful."
      : "Preguntar si tiene sentido conversar brevemente.",
    signature: useEnglish ? "KazeCode Team" : "Equipo KazeCode",
    requiredSections: [
      "opening",
      "introduction",
      "business_understanding",
      "primary_opportunity",
      "secondary_opportunity",
      "commercial_model",
      "cta",
      "signature",
    ],
    restrictedPhrases: [],
  };
}

function defaultMessagePolicy(countries: string[]): MessagePolicy {
  const uniqueCountries = [...new Set(countries)];
  if (uniqueCountries.length === 1) {
    return messagePolicyForCountry(uniqueCountries[0] ?? "AR");
  }

  return {
    ...messagePolicyForCountry("AR"),
    language: "auto",
  };
}

function normalizedSignal(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function reconcileQualificationRules(
  rules: QualificationRule[],
  positiveCriteria: string[],
  negativeCriteria: string[],
): QualificationRule[] {
  const formRules = [
    ...positiveCriteria.map((criterion) => ({ criterion, weight: 10 })),
    ...negativeCriteria.map((criterion) => ({ criterion, weight: -10 })),
  ];
  const formSignals = new Set(formRules.map((rule) => normalizedSignal(rule.criterion)));
  const preservedSignals = new Set<string>();
  const preservedRules = rules.filter((rule) => {
    const signal = normalizedSignal(rule.criterion);
    if (formSignals.has(signal) || preservedSignals.has(signal)) return false;
    preservedSignals.add(signal);
    return true;
  });

  return [...preservedRules, ...formRules];
}

export function selectMessagePolicy(
  strategy: CampaignStrategy,
  country: string,
): MessagePolicy {
  if (strategy.message.language !== "auto") return strategy.message;
  return messagePolicyForCountry(country.trim().toUpperCase());
}

export function createDefaultCampaignStrategy(
  values: CampaignStrategyDefaults,
): CampaignStrategy {
  const service = serviceLabels[values.serviceFocus] ?? "una solución digital a medida";

  return campaignStrategySchema.parse({
    version: 1,
    discovery: {
      countries: values.countries,
      regions: [],
      industries: [],
      queries: [discoveryQueryFromObjective(values.objective)],
      sources: values.sources,
      seedUrls: [],
    },
    research: {
      questions: [
        {
          key: "business_model",
          prompt: "¿Qué hace el negocio, qué ofrece y a quién vende?",
          required: true,
        },
        {
          key: "digital_presence",
          prompt: "¿Qué presencia digital oficial y activa puede verificarse?",
          required: true,
        },
        {
          key: "observable_process",
          prompt: "¿Qué proceso comercial u operativo puede observarse públicamente?",
          required: false,
        },
        {
          key: "service_opportunity",
          prompt: `¿Qué evidencia respalda una oportunidad relacionada con ${service}?`,
          required: true,
        },
      ],
    },
    qualification: {
      gates: [],
      rules: [
        ...values.positiveCriteria.map((criterion) => ({ criterion, weight: 10 })),
        ...values.negativeCriteria.map((criterion) => ({ criterion, weight: -10 })),
      ],
    },
    message: defaultMessagePolicy(values.countries),
  });
}

export function reconcileCampaignStrategy(
  values: CampaignStrategyDefaults & { strategy?: CampaignStrategy },
): CampaignStrategy {
  const strategy = values.strategy ?? createDefaultCampaignStrategy(values);

  return campaignStrategySchema.parse({
    ...strategy,
    discovery: {
      ...strategy.discovery,
      countries: values.countries,
      sources: values.sources,
    },
    qualification: {
      ...strategy.qualification,
      rules: reconcileQualificationRules(
        strategy.qualification.rules,
        values.positiveCriteria,
        values.negativeCriteria,
      ),
    },
  });
}
