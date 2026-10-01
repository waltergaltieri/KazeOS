import { describe, expect, it } from "vitest";

import {
  campaignStrategySchema,
  createDefaultCampaignStrategy,
  reconcileCampaignStrategy,
} from "./contracts";

const validStrategy = {
  version: 1,
  discovery: {
    countries: ["AR"],
    regions: ["Buenos Aires"],
    industries: ["Distribución mayorista"],
    queries: ["distribuidores con catálogo mayorista"],
    sources: ["web_search"],
    seedUrls: ["https://example.com/directorio"],
  },
  research: {
    questions: [
      {
        key: "business_model",
        prompt: "¿Qué vende el negocio y a quién?",
        required: true,
      },
      {
        key: "observable_process",
        prompt: "¿Qué proceso comercial u operativo puede observarse?",
        required: false,
      },
    ],
  },
  qualification: {
    gates: [
      {
        type: "website",
        allowed: ["NO_WEBSITE", "BAD_WEBSITE"],
      },
    ],
    rules: [
      { criterion: "Publica catálogo mayorista", weight: 10 },
      { criterion: "Ya es cliente", weight: -10 },
    ],
  },
  message: {
    language: "es-AR",
    tone: "Directo, profesional y específico",
    minimumSpecificFacts: 3,
    wordRange: { minimum: 120, maximum: 220 },
    intro: "Presentar KazeCode brevemente.",
    commercialModel: "Proponer una mejora concreta con alcance acordado.",
    cta: "Preguntar si tiene sentido conversar durante 15 minutos.",
    signature: "Equipo KazeCode",
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
    restrictedPhrases: ["garantizamos resultados"],
  },
} as const;

describe("LeadHunter campaign strategy contracts", () => {
  it("parses a structured discovery, qualification and message strategy", () => {
    expect(campaignStrategySchema.parse(validStrategy)).toMatchObject({
      discovery: { countries: ["AR"], sources: ["web_search"] },
      qualification: {
        gates: [
          { type: "website", allowed: ["NO_WEBSITE", "BAD_WEBSITE"] },
        ],
      },
      message: { language: "es-AR", minimumSpecificFacts: 3 },
    });
  });

  it("requires at least one specific fact in a message", () => {
    expect(() => campaignStrategySchema.parse({
      ...validStrategy,
      message: { ...validStrategy.message, minimumSpecificFacts: 0 },
    })).toThrow();
  });

  it("rejects duplicate research questions", () => {
    expect(() => campaignStrategySchema.parse({
      ...validStrategy,
      research: {
        questions: [
          validStrategy.research.questions[0],
          {
            ...validStrategy.research.questions[0],
            prompt: "Una redacción distinta para la misma pregunta lógica",
          },
        ],
      },
    })).toThrow();
  });

  it("rejects unsupported message locales", () => {
    expect(() => campaignStrategySchema.parse({
      ...validStrategy,
      message: { ...validStrategy.message, language: "pt-BR" },
    })).toThrow();
  });

  it("rejects automatic message locales", () => {
    expect(() => campaignStrategySchema.parse({
      ...validStrategy,
      message: { ...validStrategy.message, language: "auto" },
    })).toThrow();
  });

  it("rejects blank restricted phrases", () => {
    expect(() => campaignStrategySchema.parse({
      ...validStrategy,
      message: { ...validStrategy.message, restrictedPhrases: ["   "] },
    })).toThrow();
  });

  it("rejects website gates without allowed states", () => {
    expect(() => campaignStrategySchema.parse({
      ...validStrategy,
      qualification: {
        ...validStrategy.qualification,
        gates: [{ type: "website", allowed: [] }],
      },
    })).toThrow();
  });

  it("returns a failed parse instead of throwing for malformed seed URLs", () => {
    expect(() => campaignStrategySchema.safeParse({
      ...validStrategy,
      discovery: {
        ...validStrategy.discovery,
        seedUrls: ["https://%"],
      },
    })).not.toThrow();

    expect(campaignStrategySchema.safeParse({
      ...validStrategy,
      discovery: {
        ...validStrategy.discovery,
        seedUrls: ["https://%"],
      },
    }).success).toBe(false);
  });

  it("requires CTA and signature content in the message policy", () => {
    expect(() => campaignStrategySchema.parse({
      ...validStrategy,
      message: {
        ...validStrategy.message,
        cta: undefined,
        signature: undefined,
      },
    })).toThrow();
  });

  it("requires CTA and signature sections in the message policy", () => {
    expect(() => campaignStrategySchema.parse({
      ...validStrategy,
      message: {
        ...validStrategy.message,
        requiredSections: ["opening", "primary_opportunity"],
      },
    })).toThrow();
  });

  it("builds the same supported fallback for mixed AR and US campaigns", () => {
    const input = {
      objective: "Encontrar distribuidores con procesos de venta manuales.",
      serviceFocus: "automation",
      sources: ["web_search" as const],
      positiveCriteria: [],
      negativeCriteria: [],
    };
    const arThenUs = createDefaultCampaignStrategy({
      ...input,
      countries: ["AR", "US"],
    });
    const usThenAr = createDefaultCampaignStrategy({
      ...input,
      countries: ["US", "AR"],
    });

    expect(arThenUs.message).toEqual(usThenAr.message);
    expect(arThenUs.message.language).toBe("es-AR");
    expect("messageByCountry" in arThenUs).toBe(false);
    expect(arThenUs.message).toMatchObject({
      signature: "Quime\nKazeCode",
      cta: "¿Te serviría una conversación breve de 15 minutos la próxima semana?",
    });
  });

  it("preserves an explicitly authored singular message policy", () => {
    const strategy = createDefaultCampaignStrategy({
      objective: "Encontrar distribuidores con procesos manuales.",
      serviceFocus: "automation",
      countries: ["US"],
      sources: ["web_search"],
      positiveCriteria: [],
      negativeCriteria: [],
    });
    strategy.message = {
      ...strategy.message,
      language: "en-US",
      tone: "Warm and precise",
      cta: "Reply with the right contact if someone else owns this process.",
      signature: "Alex from KazeCode",
    };

    const reconciled = reconcileCampaignStrategy({
      objective: "Encontrar distribuidores con procesos manuales.",
      serviceFocus: "automation",
      countries: ["AR"],
      sources: ["directories"],
      positiveCriteria: [],
      negativeCriteria: [],
      strategy,
    });

    expect(reconciled.message).toEqual(strategy.message);
  });

  it("preserves an explicit exclusion discriminator during form reconciliation", () => {
    const strategy = campaignStrategySchema.parse({
      ...validStrategy,
      qualification: {
        gates: [],
        rules: [{ criterion: "Ya es cliente", weight: -50, effect: "exclude" }],
      },
    });

    const reconciled = reconcileCampaignStrategy({
      objective: "Encontrar distribuidores con procesos manuales.",
      serviceFocus: "automation",
      countries: ["AR"],
      sources: ["web_search"],
      positiveCriteria: [],
      negativeCriteria: ["Ya es cliente"],
      strategy,
    });

    expect(reconciled.qualification.rules).toEqual([
      { criterion: "Ya es cliente", weight: -10, effect: "exclude" },
    ]);
  });

  it("parses bounded structured predicates and defaults their confidence threshold", () => {
    const strategy = campaignStrategySchema.parse({
      ...validStrategy,
      qualification: {
        gates: [],
        rules: [
          {
            criterion: "Publica catálogo mayorista",
            weight: 10,
            predicate: { field: "business_model", operator: "verified_exists" },
          },
          {
            criterion: "Ya es cliente",
            weight: -10,
            effect: "exclude",
            predicate: {
              field: "existing_client",
              operator: "normalized_equals",
              expected: "yes",
              minimumConfidence: 90,
            },
          },
          {
            criterion: "Sucursales suficientes",
            weight: 20,
            predicate: {
              field: "branch_count",
              operator: "number_between",
              minimum: 2,
              maximum: 100,
            },
          },
        ],
      },
    });

    expect(strategy.qualification.rules[0]?.predicate?.minimumConfidence).toBe(75);
    expect(strategy.qualification.rules[1]?.predicate?.minimumConfidence).toBe(90);
    expect(() => campaignStrategySchema.parse({
      ...validStrategy,
      qualification: {
        gates: [],
        rules: [{
          criterion: "Rango inválido",
          weight: 10,
          predicate: { field: "branch_count", operator: "number_between", minimum: 3, maximum: 2 },
        }],
      },
    })).toThrow();
    expect(() => campaignStrategySchema.parse({
      ...validStrategy,
      qualification: {
        gates: [],
        rules: [{
          criterion: "Campo inválido",
          weight: 10,
          predicate: { field: "Bad Field", operator: "verified_exists" },
        }],
      },
    })).toThrow();
  });

  it("preserves a structured predicate during form reconciliation", () => {
    const strategy = campaignStrategySchema.parse({
      ...validStrategy,
      qualification: {
        gates: [],
        rules: [{
          criterion: "Publica catálogo mayorista",
          weight: 50,
          predicate: {
            field: "business_model",
            operator: "normalized_equals",
            expected: "wholesale",
            minimumConfidence: 80,
          },
        }],
      },
    });

    const reconciled = reconcileCampaignStrategy({
      objective: "Encontrar distribuidores con procesos manuales.",
      serviceFocus: "automation",
      countries: ["AR"],
      sources: ["web_search"],
      positiveCriteria: ["Publica catálogo mayorista"],
      negativeCriteria: [],
      strategy,
    });

    expect(reconciled.qualification.rules[0]?.predicate).toEqual({
      field: "business_model",
      operator: "normalized_equals",
      expected: "wholesale",
      minimumConfidence: 80,
    });
  });

  it("keeps generated single-country policies explicit", () => {
    const input = {
      objective: "Encontrar distribuidores con procesos manuales.",
      serviceFocus: "automation",
      sources: ["web_search" as const],
      positiveCriteria: [],
      negativeCriteria: [],
    };
    const argentina = createDefaultCampaignStrategy({
      ...input,
      countries: ["AR"],
    });
    const unitedStates = createDefaultCampaignStrategy({
      ...input,
      countries: ["US"],
    });

    expect(argentina.message.language).toBe("es-AR");
    expect(unitedStates.message.language).toBe("en-US");
  });
});
