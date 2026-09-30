import { describe, expect, it } from "vitest";

import {
  campaignFormSchema,
  campaignStatusTransitionSchema,
  leadFormSchema,
} from "./leadhunter";

const validCampaign = {
  name: "Distribuidores con pedidos manuales",
  objective: "Encontrar mayoristas que todavía toman pedidos por WhatsApp.",
  serviceFocus: "custom_management",
  countries: ["AR", "US"],
  sources: ["web_search", "directories"],
  positiveCriteria: ["Publica catálogo mayorista"],
  negativeCriteria: ["Ya es cliente"],
  searchDays: ["monday", "wednesday"],
  searchTime: "09:30",
  sendDays: ["tuesday", "thursday"],
  sendStart: "10:00",
  sendEnd: "15:30",
  timezone: "America/Argentina/Buenos_Aires",
  dailyLeadLimit: 25,
  dailyEmailLimit: 12,
  sequenceSteps: [
    {
      delayDays: 0,
      subjectInstruction: "Mencionar el canal mayorista",
      bodyInstruction: "Presentar una mejora concreta y hacer una pregunta breve",
    },
    {
      delayDays: 3,
      subjectInstruction: "Continuar el asunto anterior",
      bodyInstruction: "Agregar un ejemplo y preguntar si corresponde hablar con otra persona",
    },
  ],
};

describe("LeadHunter campaign validation", () => {
  it("normalizes a complete draft campaign", () => {
    const parsed = campaignFormSchema.parse(validCampaign);

    expect(parsed.name).toBe("Distribuidores con pedidos manuales");
    expect(parsed.countries).toEqual(["AR", "US"]);
    expect(parsed.sequenceSteps).toHaveLength(2);
  });

  it("accepts an explicit structured strategy without changing form fields", () => {
    const parsed = campaignFormSchema.parse({
      ...validCampaign,
      strategy: {
        version: 1,
        discovery: {
          countries: ["AR"],
          regions: [],
          industries: ["Distribución"],
          queries: ["distribuidores argentinos"],
          sources: ["web_search"],
          seedUrls: [],
        },
        research: {
          questions: [
            {
              key: "business_model",
              prompt: "¿Qué vende el negocio y a quién?",
              required: true,
            },
          ],
        },
        qualification: {
          gates: [],
          rules: [{ criterion: "Publica catálogo", weight: 10 }],
        },
        message: {
          language: "es-AR",
          tone: "Profesional y específico",
          minimumSpecificFacts: 3,
          wordRange: { minimum: 120, maximum: 220 },
          intro: "Presentar KazeCode brevemente.",
          commercialModel: "Proponer una mejora concreta.",
          cta: "Preguntar si tiene sentido conversar.",
          signature: "Equipo KazeCode",
          requiredSections: ["cta", "signature"],
          restrictedPhrases: [],
        },
      },
    });

    expect(parsed.strategy?.discovery.countries).toEqual(["AR"]);
    expect(parsed.positiveCriteria).toEqual(["Publica catálogo mayorista"]);
  });

  it("deduplicates criteria by their normalized signal", () => {
    const parsed = campaignFormSchema.parse({
      ...validCampaign,
      positiveCriteria: [
        "Publica catálogo mayorista",
        "  publica   CATÁLOGO mayorista  ",
      ],
    });

    expect(parsed.positiveCriteria).toEqual(["Publica catálogo mayorista"]);
  });

  it("rejects the same normalized signal as positive and negative", () => {
    const result = campaignFormSchema.safeParse({
      ...validCampaign,
      positiveCriteria: ["Publica catálogo mayorista"],
      negativeCriteria: ["  PUBLICA   catálogo mayorista  "],
    });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.negativeCriteria).toContain(
      "Un criterio no puede ser positivo y negativo a la vez.",
    );
  });

  it("rejects a sending window whose end is not after its start", () => {
    const result = campaignFormSchema.safeParse({
      ...validCampaign,
      sendStart: "15:30",
      sendEnd: "10:00",
    });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.sendEnd).toContain(
      "La hora de fin debe ser posterior a la hora de inicio.",
    );
  });

  it("requires a connected mailbox before automatic activation", () => {
    const result = campaignStatusTransitionSchema.safeParse({
      currentStatus: "draft",
      nextStatus: "active",
      automationMode: "automatic",
      mailboxId: null,
    });

    expect(result.success).toBe(false);
    expect(result.error?.flatten().fieldErrors.mailboxId).toContain(
      "Conectá una cuenta de correo antes de activar envíos automáticos.",
    );
  });

  it("does not allow an archived campaign to be reactivated", () => {
    const result = campaignStatusTransitionSchema.safeParse({
      currentStatus: "archived",
      nextStatus: "active",
      automationMode: "drafts",
      mailboxId: null,
    });

    expect(result.success).toBe(false);
  });
});

describe("LeadHunter prospect validation", () => {
  it("accepts a business without a website or email", () => {
    const result = leadFormSchema.parse({
      campaignId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: " Distribuidora Sur ",
      countryCode: "ar",
      city: "Bahía Blanca",
      website: "",
      email: "",
      sourceType: "manual",
      sourceUrl: "",
      description: "Toma pedidos por WhatsApp.",
      firstName: "",
      lastName: "",
      role: "",
      phone: "",
    });

    expect(result).toEqual(expect.objectContaining({
      name: "Distribuidora Sur",
      countryCode: "AR",
      website: null,
      email: null,
    }));
  });

  it("normalizes a website and contact email", () => {
    const result = leadFormSchema.parse({
      campaignId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Acme",
      countryCode: "US",
      website: "acme.example",
      email: " SALES@ACME.EXAMPLE ",
      sourceType: "web_search",
      sourceUrl: "https://search.example/result",
      city: "",
      description: "",
      firstName: "Sam",
      lastName: "",
      role: "Sales",
      phone: "",
    });

    expect(result.website).toBe("https://acme.example/");
    expect(result.email).toBe("sales@acme.example");
  });
});
