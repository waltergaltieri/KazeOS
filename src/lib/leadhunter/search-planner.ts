import { createHash } from "node:crypto";

import type { LeadHunterCampaignSnapshot } from "@/db/schema/leadhunter";
import type { LeadHunterSource } from "@/lib/leadhunter/contracts";

import type {
  LeadHunterSearchPlan,
  SeedUrlWorkItem,
  SourceCursor,
  SourceQueryCursor,
  SourceQueryWorkItem,
} from "./sources/contracts";

interface CreateSearchPlanInput {
  campaignVersion: number;
  campaign: LeadHunterCampaignSnapshot;
  maxQueries: number;
  previousCursors?: SourceQueryCursor[];
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }

  throw new TypeError("Search plans can contain only JSON-serializable values");
}

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function uniqueDisplayValues(values: string[]): string[] {
  const seen = new Set<string>();

  return values.flatMap((value) => {
    const displayValue = value.trim();
    const identity = normalizedText(displayValue);

    if (!identity || seen.has(identity)) return [];
    seen.add(identity);
    return [displayValue];
  });
}

function uniqueCountries(values: string[]): string[] {
  const seen = new Set<string>();

  return values.flatMap((value) => {
    const country = value.trim().toUpperCase();
    if (!country || seen.has(country)) return [];
    seen.add(country);
    return [country];
  });
}

function uniqueSources(values: LeadHunterSource[]): LeadHunterSource[] {
  return [...new Set(values)];
}

function sourceQueryIdentity(input: {
  source: LeadHunterSource;
  country: string;
  region: string | null;
  industry: string | null;
  query: string;
}): string {
  return JSON.stringify([
    input.source,
    normalizedText(input.country),
    input.region === null ? null : normalizedText(input.region),
    input.industry === null ? null : normalizedText(input.industry),
    normalizedText(input.query),
  ]);
}

function previousCursorMap(
  cursors: SourceQueryCursor[],
): Map<string, SourceCursor> {
  return new Map(cursors.map((cursor) => [
    sourceQueryIdentity(cursor),
    cursor.cursor,
  ]));
}

function seedUrlWork(seedUrls: string[]): SeedUrlWorkItem[] {
  const seen = new Set<string>();

  return seedUrls.flatMap((value) => {
    const url = value.trim();
    if (!url || seen.has(url)) return [];
    seen.add(url);

    return [{
      kind: "seed_url" as const,
      id: `seed:${hash(url)}`,
      url,
    }];
  });
}

export function createSearchPlan({
  campaignVersion,
  campaign,
  maxQueries,
  previousCursors = [],
}: CreateSearchPlanInput): LeadHunterSearchPlan {
  if (!Number.isInteger(campaignVersion) || campaignVersion < 1) {
    throw new RangeError("campaignVersion must be a positive integer");
  }
  if (!Number.isInteger(maxQueries) || maxQueries < 0) {
    throw new RangeError("maxQueries must be a non-negative integer");
  }

  const { discovery } = campaign.strategy;
  const sources = uniqueSources(discovery.sources);
  const countries = uniqueCountries(discovery.countries);
  const regions = uniqueDisplayValues(discovery.regions);
  const industries = uniqueDisplayValues(discovery.industries);
  const queries = uniqueDisplayValues(discovery.queries);
  const regionValues = regions.length > 0 ? regions : [null];
  const industryValues = industries.length > 0 ? industries : [null];
  const cursors = previousCursorMap(previousCursors);
  const generatedWork: SourceQueryWorkItem[] = [];

  planning:
  for (const source of sources) {
    for (const country of countries) {
      for (const region of regionValues) {
        for (const industry of industryValues) {
          for (const query of queries) {
            if (generatedWork.length >= maxQueries) break planning;

            const identity = sourceQueryIdentity({
              source,
              country,
              region,
              industry,
              query,
            });
            generatedWork.push({
              kind: "source_query",
              id: `query:${hash(identity)}`,
              source,
              country,
              region,
              industry,
              query,
              cursor: cursors.get(identity) ?? null,
              geographyEvidence: null,
            });
          }
        }
      }
    }
  }

  const planWithoutHash = {
    planVersion: 1 as const,
    campaignVersion,
    budget: {
      maxQueries,
      plannedQueries: generatedWork.length,
      maxCandidates: campaign.dailyLeadLimit,
    },
    work: [
      ...generatedWork,
      ...seedUrlWork(discovery.seedUrls),
    ],
  };

  return {
    ...planWithoutHash,
    planHash: hash(stableStringify(planWithoutHash)),
  };
}
