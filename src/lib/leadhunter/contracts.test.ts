import { describe, expect, it } from "vitest";

import { campaignStrategySchema } from "./contracts";

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
});
