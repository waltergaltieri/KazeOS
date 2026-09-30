import { describe, expect, it, vi } from "vitest";

import type { LeadHunterCampaignSnapshot } from "@/db/schema/leadhunter";

import { createSearchPlan } from "./search-planner";
import type {
  SourceDiscoveryPage,
  SourceQueryCursor,
} from "./sources/contracts";

const campaignSnapshot = {
  objective: "Encontrar distribuidores con venta mayorista.",
  serviceFocus: "automation",
  countries: ["AR"],
  sources: ["web_search", "directories", "web_search"],
  positiveCriteria: ["Publica un catálogo mayorista"],
  negativeCriteria: [],
  strategy: {
    version: 1,
    discovery: {
      countries: ["AR", " ar ", "AR"],
      regions: ["Buenos Aires", "  buenos   AIRES  ", "Buenos Aires"],
      industries: [
        "Distribución mayorista",
        "  distribución   MAYORISTA  ",
      ],
      queries: [
        "Mayoristas   de alimentos",
        "  mayoristas de ALIMENTOS  ",
      ],
      sources: ["web_search", "directories", "web_search"],
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
        cursor: { state: "initial" },
      }),
      expect.objectContaining({
        kind: "source_query",
        source: "directories",
        country: "AR",
        industry: "Distribución mayorista",
        query: "Mayoristas   de alimentos",
        cursor: { state: "initial" },
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
        cursor: { state: "next", value: "page:2" },
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
      { source: "web_search", country: "AR", cursor: { state: "initial" } },
      {
        source: "directories",
        country: "AR",
        cursor: { state: "next", value: "page:2" },
      },
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
        cursor: {
          state: "next",
          value: { page: 2, engine: "general" },
        },
      }],
    });
    const second = createSearchPlan({
      campaignVersion: 7,
      campaign: campaignSnapshot,
      maxQueries: 10,
      previousCursors: [{
        ...cursorIdentity,
        cursor: {
          state: "next",
          value: { engine: "general", page: 2 },
        },
      }],
    });

    expect(second.planHash).toBe(first.planHash);
  });

  it("continues through later combinations without exceeding the query budget", () => {
    const expandedCampaign: LeadHunterCampaignSnapshot = structuredClone(campaignSnapshot);
    expandedCampaign.strategy.discovery.countries = ["AR", "US"];
    const completePlan = createSearchPlan({
      campaignVersion: 7,
      campaign: expandedCampaign,
      maxQueries: 10,
    });
    const expectedIds = sourceQueries(completePlan).map((work) => work.id);
    const visitedIds: string[] = [];
    let planningCursor = { offset: 0 };

    for (let run = 0; run < expectedIds.length; run += 1) {
      const plan = createSearchPlan({
        campaignVersion: 7,
        campaign: expandedCampaign,
        maxQueries: 1,
        planningCursor,
      });
      const work = sourceQueries(plan);

      expect(work).toHaveLength(1);
      visitedIds.push(work[0]!.id);
      planningCursor = plan.nextPlanningCursor;
    }

    expect(visitedIds).toEqual(expectedIds);
    expect(planningCursor).toEqual({ offset: 0 });
  });

  it("keeps the planning offset stable when an earlier combination becomes exhausted", () => {
    const expandedCampaign: LeadHunterCampaignSnapshot = structuredClone(campaignSnapshot);
    expandedCampaign.strategy.discovery.countries = ["AR", "US"];
    const completePlan = createSearchPlan({
      campaignVersion: 7,
      campaign: expandedCampaign,
      maxQueries: 10,
    });
    const completeWork = sourceQueries(completePlan);
    const firstPlan = createSearchPlan({
      campaignVersion: 7,
      campaign: expandedCampaign,
      maxQueries: 1,
    });
    const firstWork = sourceQueries(firstPlan)[0]!;
    const previousCursors: SourceQueryCursor[] = [{
      source: firstWork.source,
      country: firstWork.country,
      region: firstWork.region,
      industry: firstWork.industry,
      query: firstWork.query,
      cursor: { state: "exhausted" },
    }];

    const resumedPlan = createSearchPlan({
      campaignVersion: 7,
      campaign: expandedCampaign,
      maxQueries: 1,
      planningCursor: firstPlan.nextPlanningCursor,
      previousCursors,
    });

    expect(sourceQueries(resumedPlan).map((work) => work.id))
      .toEqual([completeWork[1]!.id]);
  });

  it("does not reschedule an exhausted source query", () => {
    const previousCursors: SourceQueryCursor[] = [
      {
        source: "web_search",
        country: "AR",
        region: "Buenos Aires",
        industry: "Distribución mayorista",
        query: "Mayoristas de alimentos",
        cursor: { state: "exhausted" },
      },
      {
        source: "directories",
        country: "AR",
        region: "Buenos Aires",
        industry: "Distribución mayorista",
        query: "Mayoristas de alimentos",
        cursor: { state: "next", value: "page:2" },
      },
    ];

    const plan = createSearchPlan({
      campaignVersion: 7,
      campaign: campaignSnapshot,
      maxQueries: 10,
      previousCursors,
    });

    expect(sourceQueries(plan)).toEqual([
      expect.objectContaining({
        source: "directories",
        cursor: { state: "next", value: "page:2" },
      }),
    ]);
  });

  it("uses explicit continuation states in source results", () => {
    const page = {
      candidates: [],
      nextCursor: { state: "exhausted" },
    } satisfies SourceDiscoveryPage;

    expect(page.nextCursor).toEqual({ state: "exhausted" });
  });

  it("deep-clones cursor input and keeps the recorded hash stable", () => {
    const cursorValue = {
      page: 2,
      nested: { token: "original" },
      ranks: [1, 2],
    };
    const previousCursors: SourceQueryCursor[] = [{
      source: "directories",
      country: "AR",
      region: "Buenos Aires",
      industry: "Distribución mayorista",
      query: "Mayoristas de alimentos",
      cursor: { state: "next", value: cursorValue },
    }];
    const plan = createSearchPlan({
      campaignVersion: 7,
      campaign: campaignSnapshot,
      maxQueries: 10,
      previousCursors,
    });
    const hashBeforeMutation = plan.planHash;
    const work = sourceQueries(plan).find(({ source }) => source === "directories")!;

    cursorValue.nested.token = "changed-input";
    cursorValue.ranks.push(3);
    expect(work.cursor).toEqual({
      state: "next",
      value: {
        page: 2,
        nested: { token: "original" },
        ranks: [1, 2],
      },
    });

    if (work.cursor.state !== "next") throw new Error("Expected a next cursor");
    const plannedValue = work.cursor.value as typeof cursorValue;
    plannedValue.nested.token = "changed-output";
    plannedValue.ranks.push(4);

    expect(cursorValue).toEqual({
      page: 2,
      nested: { token: "changed-input" },
      ranks: [1, 2, 3],
    });
    expect(plan.planHash).toBe(hashBeforeMutation);
  });

  it.each([
    ["NaN", Number.NaN],
    ["positive infinity", Number.POSITIVE_INFINITY],
    ["negative infinity", Number.NEGATIVE_INFINITY],
    ["negative zero", -0],
    ["undefined", undefined],
    ["bigint", BigInt(1)],
    ["function", () => undefined],
    ["symbol", Symbol("cursor")],
    ["date", new Date("2026-09-30T00:00:00.000Z")],
  ])("rejects the non-JSON-safe cursor value %s", (_label, invalidValue) => {
    const previousCursors = [{
      source: "directories",
      country: "AR",
      region: "Buenos Aires",
      industry: "Distribución mayorista",
      query: "Mayoristas de alimentos",
      cursor: { state: "next", value: invalidValue },
    }] as unknown as SourceQueryCursor[];

    expect(() => createSearchPlan({
      campaignVersion: 7,
      campaign: campaignSnapshot,
      maxQueries: 10,
      previousCursors,
    })).toThrow(/JSON/i);
  });

  it("rejects cyclic cursor objects", () => {
    const cyclicCursor: Record<string, unknown> = {};
    cyclicCursor.self = cyclicCursor;

    expect(() => createSearchPlan({
      campaignVersion: 7,
      campaign: campaignSnapshot,
      maxQueries: 10,
      previousCursors: [{
        source: "directories",
        country: "AR",
        region: "Buenos Aires",
        industry: "Distribución mayorista",
        query: "Mayoristas de alimentos",
        cursor: { state: "next", value: cyclicCursor },
      }] as unknown as SourceQueryCursor[],
    })).toThrow(/JSON/i);
  });

  it("rejects sparse arrays and symbol properties in cursor state", () => {
    const sparseArray = Array<unknown>(1);
    const symbolKey = Symbol("hidden");
    const invalidCursors = [
      { state: "next", value: sparseArray },
      { state: "next", value: "page:2", [symbolKey]: "hidden" },
    ];

    for (const cursor of invalidCursors) {
      expect(() => createSearchPlan({
        campaignVersion: 7,
        campaign: campaignSnapshot,
        maxQueries: 10,
        previousCursors: [{
          source: "directories",
          country: "AR",
          region: "Buenos Aires",
          industry: "Distribución mayorista",
          query: "Mayoristas de alimentos",
          cursor,
        }] as unknown as SourceQueryCursor[],
      })).toThrow(/JSON/i);
    }
  });

  it.each([
    ["negative zero", -0],
    ["unsafe integer", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects the non-durable planning offset %s", (_label, offset) => {
    expect(() => createSearchPlan({
      campaignVersion: 7,
      campaign: campaignSnapshot,
      maxQueries: 10,
      planningCursor: { offset },
    })).toThrow(/planningCursor/);
  });
});
