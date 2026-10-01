import type {
  FetchLike,
  HostnameResolver,
} from "../safe-url";
import {
  type SearchPlanWorkItem,
  type SourceAdapter,
  type SourceAdapterId,
  type SourceQueryWorkItem,
  SourceUnavailableError,
} from "./contracts";
import { createSearxngAdapter } from "./searxng";
import { createSeedUrlAdapter } from "./seed-urls";

const sourceIds = [
  "web_search",
  "seed_url",
  "directories",
  "instagram",
  "linkedin",
  "csv",
  "manual",
] as const satisfies readonly SourceAdapterId[];

export interface SourceRegistryOptions {
  searxngEndpoint?: string;
  fetch?: FetchLike;
  resolve?: HostnameResolver;
}

export interface SourceRegistry {
  get(source: SourceAdapterId): SourceAdapter;
  forWork(work: SearchPlanWorkItem): SourceAdapter;
  list(): readonly SourceAdapter[];
}

function unavailableAdapter(source: SourceAdapterId, reason: string): SourceAdapter {
  return {
    source,
    capabilities: {
      discovery: false,
      enrichment: false,
      contactSearch: false,
      supportsCursor: false,
      live: false,
      unavailableReason: reason,
    },
    async discover() {
      throw new SourceUnavailableError(reason);
    },
  };
}

function publicChannelAdapter(source: "directories" | "instagram" | "linkedin", search: SourceAdapter): SourceAdapter {
  const suffix = source === "instagram" ? "site:instagram.com" : source === "linkedin" ? "site:linkedin.com/company" : "(directory OR chamber OR Yelp OR Paginas Amarillas OR Yellow Pages)";
  return {
    source,
    capabilities: { ...search.capabilities, enrichment: false, contactSearch: false },
    async discover(work) {
      if (work.kind !== "source_query" || work.source !== source) throw new TypeError(`${source} accepts only its own source queries`);
      const delegated: SourceQueryWorkItem = { ...work, source: "web_search", query: `${work.query.slice(0, 499 - suffix.length)} ${suffix}` };
      const page = await search.discover(delegated);
      return { ...page, candidates: page.candidates.map((candidate) => ({ ...candidate, sourceType: source })) };
    },
  };
}

export function createSourceRegistry({
  searxngEndpoint = process.env.LEADHUNTER_SEARXNG_ENDPOINT,
  fetch,
  resolve,
}: SourceRegistryOptions = {}): SourceRegistry {
  const webSearch = createSearxngAdapter({ endpoint: searxngEndpoint, fetch, resolve });
  const configured: SourceAdapter[] = [
    webSearch,
    createSeedUrlAdapter({ resolve }),
    publicChannelAdapter("directories", webSearch),
    publicChannelAdapter("instagram", webSearch),
    publicChannelAdapter("linkedin", webSearch),
    unavailableAdapter("csv", "CSV discovery is not implemented"),
    unavailableAdapter("manual", "Manual discovery does not have an automated adapter"),
  ];
  const adapters = new Map(configured.map((adapter) => [adapter.source, adapter]));
  const get = (source: SourceAdapterId) => {
    const adapter = adapters.get(source);
    if (!adapter) throw new SourceUnavailableError(`Unknown source: ${source}`);
    return adapter;
  };

  return {
    get,
    forWork(work) {
      return get(work.kind === "seed_url" ? "seed_url" : work.source);
    },
    list() {
      return sourceIds.map(get);
    },
  };
}
