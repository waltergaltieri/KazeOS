import type {
  FetchLike,
  HostnameResolver,
} from "../safe-url";
import {
  type SearchPlanWorkItem,
  type SourceAdapter,
  type SourceAdapterId,
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

export function createSourceRegistry({
  searxngEndpoint,
  fetch,
  resolve,
}: SourceRegistryOptions = {}): SourceRegistry {
  const configured: SourceAdapter[] = [
    createSearxngAdapter({ endpoint: searxngEndpoint, fetch, resolve }),
    createSeedUrlAdapter({ resolve }),
    unavailableAdapter("directories", "Directory discovery is not implemented"),
    unavailableAdapter("instagram", "Instagram discovery is not implemented"),
    unavailableAdapter("linkedin", "LinkedIn discovery is not implemented"),
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
