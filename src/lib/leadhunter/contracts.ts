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

const qualificationPredicateFieldSchema = z.string().trim()
  .regex(/^[a-z][a-z0-9_.-]{0,99}$/);
const qualificationPredicateBase = {
  field: qualificationPredicateFieldSchema,
  minimumConfidence: z.number().int().min(1).max(100).default(75),
};

export const qualificationPredicateSchema = z.discriminatedUnion("operator", [
  z.object({
    ...qualificationPredicateBase,
    operator: z.literal("verified_exists"),
  }).strict(),
  z.object({
    ...qualificationPredicateBase,
    operator: z.literal("normalized_equals"),
    expected: nonBlankText(2_000),
  }).strict(),
  z.object({
    ...qualificationPredicateBase,
    operator: z.literal("number_between"),
    minimum: z.number().finite(),
    maximum: z.number().finite(),
  }).strict().refine((predicate) => predicate.maximum >= predicate.minimum, {
    path: ["maximum"],
    message: "El máximo del predicado debe ser mayor o igual al mínimo.",
  }),
]);

export const qualificationRuleSchema = z
  .object({
    criterion: nonBlankText(240),
    weight: z.number().int().min(-100).max(100).refine((weight) => weight !== 0),
    effect: z.enum(["score", "exclude"]).default("score"),
    predicate: qualificationPredicateSchema.optional(),
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
    language: z.enum(["es-AR", "en-US"]),
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
export type QualificationRule = z.input<typeof qualificationRuleSchema>;
export type QualificationPredicate = z.infer<typeof qualificationPredicateSchema>;
export type MessagePolicy = z.infer<typeof messagePolicySchema>;
export type CampaignStrategy = z.input<typeof campaignStrategySchema>;

interface CampaignStrategyDefaults {
  objective: string;
  serviceFocus: string;
  countries: string[];
  sources: LeadHunterSource[];
  positiveCriteria: string[];
  negativeCriteria: string[];
  messageLanguage?: "es-AR" | "en-US";
  messageCta?: string;
  messageSignature?: string;
  restrictedPhrases?: string[];
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
      ? "Personal, conversational, professional and specific; an outside observation, not a company report"
      : "Cercano, conversacional, profesional y específico; una lectura desde afuera, no un informe empresarial",
    minimumSpecificFacts: 3,
    wordRange: { minimum: 200, maximum: 350 },
    intro: useEnglish
      ? "I’m Walter, co-founder of KazeCode. We help businesses strengthen their digital presence and build custom software and automation around the way they actually operate."
      : "Soy Walter, cofundador de KazeCode. Ayudamos a empresas a mejorar su presencia digital y desarrollamos sistemas y automatizaciones a medida alrededor de la operación real del negocio.",
    commercialModel: useEnglish
      ? "Custom technology can seem complex or reserved for much larger companies. At KazeCode we make it accessible through a monthly subscription that includes development, hosting, maintenance, support and ongoing improvements."
      : "Muchas veces la tecnología a medida se percibe como algo complejo o reservado a empresas mucho más grandes. En KazeCode la acercamos a negocios de distintos tamaños mediante una suscripción mensual que incluye desarrollo, hosting, mantenimiento, soporte y mejoras continuas.",
    cta: useEnglish
      ? "If this sounds worth exploring, I’d be happy to continue by email or set up a short Google Meet."
      : "Si te parece interesante, podemos verlo en un Google Meet corto, seguir por este correo o hablar por WhatsApp.",
    signature: useEnglish
      ? "Walter Quimey Galtieri\nCo-Founder, KazeCode\nhttps://kazecode.com.ar/en/"
      : "Walter Quimey Galtieri\nCo-Founder, KazeCode\n+54 9 11 2505-0687\nWhatsApp: https://wa.me/5491125050687\nhttps://kazecode.com.ar",
    requiredSections: [
      "opening",
      "introduction",
      "business_understanding",
      "primary_opportunity",
      "commercial_model",
      "cta",
      "signature",
    ],
    restrictedPhrases: [],
  };
}

function defaultMessagePolicy(countries: string[]): MessagePolicy {
  const uniqueCountries = new Set(countries);
  return messagePolicyForCountry(
    uniqueCountries.size === 1 && uniqueCountries.has("US") ? "US" : "AR",
  );
}

function normalizedSignal(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function reconcileQualificationRules(
  rules: QualificationRule[],
  positiveCriteria: string[],
  negativeCriteria: string[],
): QualificationRule[] {
  const authoredRules = new Map(
    rules.map((rule) => [normalizedSignal(rule.criterion), rule]),
  );
  const formRules = [
    ...positiveCriteria.map((criterion) => {
      const authored = authoredRules.get(normalizedSignal(criterion));
      return {
        criterion,
        weight: 10,
        effect: authored?.effect === "exclude" ? "exclude" as const : "score" as const,
        ...(authored?.predicate ? { predicate: authored.predicate } : {}),
      };
    }),
    ...negativeCriteria.map((criterion) => {
      const authored = authoredRules.get(normalizedSignal(criterion));
      return {
        criterion,
        weight: -10,
        effect: authored?.effect === "exclude" ? "exclude" as const : "score" as const,
        ...(authored?.predicate ? { predicate: authored.predicate } : {}),
      };
    }),
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
        { key: "products_services", prompt: "¿Qué productos o servicios concretos ofrece? Copiá una descripción publicada.", required: false },
        { key: "customer_profile", prompt: "¿A qué tipos de clientes declara atender?", required: false },
        { key: "sales_channels", prompt: "¿Cómo publica que se compra, se pide o se recibe su servicio?", required: false },
        { key: "business_history", prompt: "¿Qué trayectoria o especialización concreta declara la empresa? Omití eslóganes y superlativos.", required: false },
        { key: "business_capabilities", prompt: "¿Qué capacidades, aplicaciones, proyectos o sectores atendidos publica?", required: false },
        { key: "service_coverage", prompt: "¿Qué zonas de atención o condiciones de entrega declara?", required: false },
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
          required: false,
        },
      ],
    },
    qualification: {
      gates: [],
      rules: [
        ...values.positiveCriteria.map((criterion) => ({
          criterion,
          weight: 10,
          effect: "score",
        })),
        ...values.negativeCriteria.map((criterion) => ({
          criterion,
          weight: -10,
          effect: "score",
        })),
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
    message: {
      ...strategy.message,
      language: values.messageLanguage ?? strategy.message.language,
      cta: values.messageCta ?? strategy.message.cta,
      signature: values.messageSignature ?? strategy.message.signature,
      restrictedPhrases: values.restrictedPhrases ?? strategy.message.restrictedPhrases,
    },
  });
}
