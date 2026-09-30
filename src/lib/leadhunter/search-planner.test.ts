import { describe, expect, it, vi } from "vitest";

import type { LeadHunterCampaignSnapshot } from "@/db/schema/leadhunter";

import { createSearchPlan } from "./search-planner";
import type { SourceQueryCursor } from "./sources/contracts";

const campaignSnapshot = {
  objective: "Encontrar distribuidores con venta mayorista.",
  serviceFocus: "automation",
  countries: ["AR"],
  sources: ["web_search", "directories"],
  positiveCriteria: ["Publica un catálogo mayorista"],
  negativeCriteria: [],
  strategy: {
    version: 1,
    discovery: {
      countries: ["AR"],
      regions: ["Buenos Aires"],
      industries: [
        "Distribución mayorista",
        "  distribución   MAYORISTA  ",
      ],
      queries: [
        "Mayoristas   de alimentos",
        "  mayoristas de ALIMENTOS  ",
      ],
      sources: ["web_search", "directories"],
      seedUrls: [
        "https://example.com/directorio-a",
        " https://example.com/directorio-a ",
        "https://example.com/directorio-b",
      ],
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
    qualification: { gates: [], rules: [] },
    message: {
      language: "es-AR",
      tone: "Directo y específico",
      minimumSpecificFacts: 3,
      wordRange: { minimum: 120, maximum: 220 },
      intro: "Presentar KazeCode brevemente.",
      commercialModel: "Proponer una mejora con alcance acordado.",
      cta: "Preguntar si tiene sentido conversar.",
      signature: "Equipo KazeCode",
      requiredSections: ["cta", "signature"],
      restrictedPhrases: [],
    },
  },
  schedule: {
    searchDays: ["monday"],
    searchTime: "09:00",
    sendDays: ["monday"],
    sendStart: "10:00",
    sendEnd: "17:00",
    timezone: "America/Argentina/Buenos_Aires",
  },
  dailyLeadLimit: 30,
  dailyEmailLimit: 10,
  sequenceSteps: [
    {
      delayDays: 0,
      subjectInstruction: "Asunto específico",
      bodyInstruction: "Mensaje breve",
    },
  ],
} satisfies LeadHunterCampaignSnapshot;

function sourceQueries(plan: ReturnType<typeof createSearchPlan>) {
  return plan.work.filter((work) => work.kind === "source_query");
}

describe("LeadHunter search planner", () => {
  it("deduplicates normalized source, country, industry and query combinations", () => {
    const plan = createSearchPlan({
      campaignVersion: 7,
      campaign: campaignSnapshot,
      maxQueries: 10,
    });

    expect(sourceQueries(plan)).toEqual([
      expect.objectContaining({
        kind: "source_query",
        source: "web_search",
        country: "AR",
        industry: "Distribución mayorista",
        query: "Mayoristas   de alimentos",
        cursor: null,
      }),
      expect.objectContaining({
        kind: "source_query",
        source: "directories",
        country: "AR",
        industry: "Distribución mayorista",
        query: "Mayoristas   de alimentos",
        cursor: null,
      }),
    ]);
  });

  it("respects the query budget and takes the candidate budget from the campaign", () => {
    const expandedCampaign: LeadHunterCampaignSnapshot = structuredClone(campaignSnapshot);
    expandedCampaign.strategy.discovery.countries = ["AR", "US"];

    const plan = createSearchPlan({
      campaignVersion: 7,
      campaign: expandedCampaign,
      maxQueries: 3,
    });

    expect(sourceQueries(plan)).toHaveLength(3);
    expect(plan.budget).toEqual({
      maxQueries: 3,
      plannedQueries: 3,
      maxCandidates: 30,
    });
  });

  it("carries a previous cursor for its matching source query only", () => {
    const previousCursors: SourceQueryCursor[] = [
      {
        source: "directories",
        country: "ar",
        region: " buenos   AIRES ",
        industry: "distribución mayorista",
        query: " mayoristas de alimentos ",
        cursor: "page:2",
      },
    ];

    const plan = createSearchPlan({
      campaignVersion: 7,
      campaign: campaignSnapshot,
      maxQueries: 10,
      previousCursors,
    });

    expect(sourceQueries(plan).map(({ source, country, cursor }) => ({
      source,
      country,
      cursor,
    }))).toEqual([
      { source: "web_search", country: "AR", cursor: null },
      { source: "directories", country: "AR", cursor: "page:2" },
    ]);
  });

  it("keeps seed URLs separate from generated searches", () => {
    const plan = createSearchPlan({
      campaignVersion: 7,
      campaign: campaignSnapshot,
      maxQueries: 10,
    });
    const seeds = plan.work.filter((work) => work.kind === "seed_url");

    expect(seeds).toEqual([
      {
        kind: "seed_url",
        id: expect.any(String),
        url: "https://example.com/directorio-a",
      },
      {
        kind: "seed_url",
        id: expect.any(String),
        url: "https://example.com/directorio-b",
      },
    ]);
    expect(sourceQueries(plan).every((work) => !("url" in work))).toBe(true);
  });

  it("keeps campaign geography as an unverified target regardless of query language", () => {
    const englishQueryForArgentina: LeadHunterCampaignSnapshot = structuredClone(campaignSnapshot);
    englishQueryForArgentina.strategy.discovery.queries = [
      "wholesale food distributors",
    ];
    englishQueryForArgentina.strategy.message.language = "en-US";

    const plan = createSearchPlan({
      campaignVersion: 7,
      campaign: englishQueryForArgentina,
      maxQueries: 1,
    });
    const [work] = sourceQueries(plan);

    expect(work).toMatchObject({
      country: "AR",
      region: "Buenos Aires",
      query: "wholesale food distributors",
      geographyEvidence: null,
    });
  });

  it("returns deterministic, JSON-serializable work without calling the network", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const input = {
      campaignVersion: 7,
      campaign: campaignSnapshot,
      maxQueries: 10,
    } as const;

    const first = createSearchPlan(input);
    const second = createSearchPlan(input);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(first).not.toBeInstanceOf(Promise);
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
    expect(first.campaignVersion).toBe(7);
    expect(first.planHash).toMatch(/^[a-f0-9]{64}$/);
    expect(second.planHash).toBe(first.planHash);
    expect(createSearchPlan({ ...input, campaignVersion: 8 }).planHash)
      .not.toBe(first.planHash);
  });

  it("hashes equivalent object cursors deterministically", () => {
    const cursorIdentity = {
      source: "web_search" as const,
      country: "AR",
      region: "Buenos Aires",
      industry: "Distribución mayorista",
      query: "Mayoristas de alimentos",
    };
    const first = createSearchPlan({
      campaignVersion: 7,
      campaign: campaignSnapshot,
      maxQueries: 10,
      previousCursors: [{
        ...cursorIdentity,
        cursor: { page: 2, engine: "general" },
      }],
    });
    const second = createSearchPlan({
      campaignVersion: 7,
      campaign: campaignSnapshot,
      maxQueries: 10,
      previousCursors: [{
        ...cursorIdentity,
        cursor: { engine: "general", page: 2 },
      }],
    });

    expect(second.planHash).toBe(first.planHash);
  });
});
