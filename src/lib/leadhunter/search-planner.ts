import { createHash } from "node:crypto";

import type { LeadHunterCampaignSnapshot } from "@/db/schema/leadhunter";
import type { LeadHunterSource } from "@/lib/leadhunter/contracts";

import type {
  LeadHunterSearchPlan,
  JsonValue,
  SearchPlanningCursor,
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
  planningCursor?: SearchPlanningCursor;
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

function cloneJsonValue(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new TypeError("Cursor values must be JSON-safe finite numbers");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError("Cursor values must be JSON-safe");
  }
  if (ancestors.has(value)) {
    throw new TypeError("Cursor values must be acyclic JSON data");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      if (ownKeys.length !== value.length + 1) {
        throw new TypeError("Cursor arrays must contain only JSON-safe indexed values");
      }
      const clonedValues: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor)) {
          throw new TypeError("Cursor arrays must contain only JSON-safe indexed values");
        }
        clonedValues.push(cloneJsonValue(descriptor.value, ancestors));
      }
      if (ownKeys.some((key) => (
        typeof key !== "string"
        || (key !== "length" && !/^\d+$/.test(key))
      ))) {
        throw new TypeError("Cursor arrays must contain only JSON-safe indexed values");
      }
      return clonedValues;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Cursor objects must be plain JSON-safe objects");
    }

    const entries = Reflect.ownKeys(value).map((key): [string, JsonValue] => {
      if (typeof key !== "string") {
        throw new TypeError("Cursor JSON objects cannot contain symbol keys");
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !("value" in descriptor)) {
        throw new TypeError("Cursor objects must contain enumerable JSON-safe values");
      }
      return [key, cloneJsonValue(descriptor.value, ancestors)];
    });

    return Object.fromEntries(entries);
  } finally {
    ancestors.delete(value);
  }
}

function cloneSourceCursor(cursor: SourceCursor): SourceCursor {
  const cloned = cloneJsonValue(cursor);
  if (!cloned || typeof cloned !== "object" || Array.isArray(cloned)) {
    throw new TypeError("Source cursor state must be JSON-safe");
  }

  const keys = Object.keys(cloned).sort();
  if (cloned.state === "initial" || cloned.state === "exhausted") {
    if (keys.length !== 1 || keys[0] !== "state") {
      throw new TypeError("Source cursor state must be explicit JSON-safe data");
    }
    return { state: cloned.state };
  }
  if (cloned.state === "next") {
    if (keys.length !== 2 || keys[0] !== "state" || keys[1] !== "value") {
      throw new TypeError("Next source cursor must contain one JSON-safe value");
    }
    return { state: "next", value: cloned.value! };
  }

  throw new TypeError("Unknown JSON-safe source cursor state");
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
    cloneSourceCursor(cursor.cursor),
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

const scanMultiplier = 4;
const maximumScanBudget = 10_000;

function combinationCount(dimensions: number[]): number {
  const total = dimensions.reduce((product, length) => product * length, 1);
  if (!Number.isSafeInteger(total)) {
    throw new RangeError("Search plan combination count exceeds the safe integer range");
  }
  return total;
}

function combinationAt(
  flatIndex: number,
  dimensions: {
    sources: LeadHunterSource[];
    countries: string[];
    regions: (string | null)[];
    industries: (string | null)[];
    queries: string[];
  },
) {
  let remainder = flatIndex;
  const query = dimensions.queries[remainder % dimensions.queries.length]!;
  remainder = Math.floor(remainder / dimensions.queries.length);
  const industry = dimensions.industries[
    remainder % dimensions.industries.length
  ]!;
  remainder = Math.floor(remainder / dimensions.industries.length);
  const region = dimensions.regions[remainder % dimensions.regions.length]!;
  remainder = Math.floor(remainder / dimensions.regions.length);
  const country = dimensions.countries[
    remainder % dimensions.countries.length
  ]!;
  remainder = Math.floor(remainder / dimensions.countries.length);
  const source = dimensions.sources[remainder % dimensions.sources.length]!;

  return { source, country, region, industry, query };
}

export function createSearchPlan({
  campaignVersion,
  campaign,
  maxQueries,
  previousCursors = [],
  planningCursor = { offset: 0 },
}: CreateSearchPlanInput): LeadHunterSearchPlan {
  if (!Number.isSafeInteger(campaignVersion) || campaignVersion < 1) {
    throw new RangeError("campaignVersion must be a positive integer");
  }
  if (
    !Number.isSafeInteger(maxQueries)
    || maxQueries < 0
    || Object.is(maxQueries, -0)
  ) {
    throw new RangeError("maxQueries must be a non-negative integer");
  }
  if (
    !Number.isSafeInteger(planningCursor.offset)
    || planningCursor.offset < 0
    || Object.is(planningCursor.offset, -0)
  ) {
    throw new RangeError("planningCursor.offset must be a non-negative integer");
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
  const dimensions = {
    sources,
    countries,
    regions: regionValues,
    industries: industryValues,
    queries,
  };
  const totalQueries = combinationCount([
    sources.length,
    countries.length,
    regionValues.length,
    industryValues.length,
    queries.length,
  ]);

  const generatedWork: SourceQueryWorkItem[] = [];
  const startOffset = totalQueries === 0
    ? 0
    : planningCursor.offset % totalQueries;
  let nextOffset = startOffset;
  let scannedWork = 0;
  const scanBudget = Math.min(
    totalQueries,
    maxQueries * scanMultiplier,
    maximumScanBudget,
  );

  while (
    generatedWork.length < maxQueries
    && scannedWork < scanBudget
  ) {
    const combination = combinationAt(nextOffset, dimensions);
    const identity = sourceQueryIdentity(combination);
    const cursor = cursors.get(identity) ?? { state: "initial" };
    nextOffset = (nextOffset + 1) % totalQueries;
    scannedWork += 1;
    if (cursor.state === "exhausted") continue;

    generatedWork.push({
      kind: "source_query",
      id: `query:${hash(identity)}`,
      ...combination,
      cursor,
      geographyEvidence: null,
    });
  }

  const planWithoutHash = {
    planVersion: 1 as const,
    campaignVersion,
    budget: {
      maxQueries,
      plannedQueries: generatedWork.length,
      maxCandidates: campaign.dailyLeadLimit,
      totalQueries,
      scannedQueries: scannedWork,
    },
    work: [
      ...generatedWork,
      ...seedUrlWork(discovery.seedUrls),
    ],
    nextPlanningCursor: { offset: nextOffset },
  };

  return {
    ...planWithoutHash,
    planHash: hash(stableStringify(planWithoutHash)),
  };
}
