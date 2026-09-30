import {
  type HostnameResolver,
  validatePublicUrl,
} from "../safe-url";
import type {
  SearchPlanWorkItem,
  SeedUrlWorkItem,
  SourceAdapter,
} from "./contracts";

export interface SeedUrlAdapterOptions {
  resolve?: HostnameResolver;
}

function assertSeedWork(work: SearchPlanWorkItem): SeedUrlWorkItem {
  if (work.kind !== "seed_url") {
    throw new TypeError("Seed URL adapter accepts only seed_url work");
  }
  return work;
}

export function createSeedUrlAdapter({
  resolve,
}: SeedUrlAdapterOptions = {}): SourceAdapter {
  return {
    source: "seed_url",
    capabilities: {
      discovery: true,
      enrichment: false,
      contactSearch: false,
      supportsCursor: false,
      live: true,
    },
    async discover(input) {
      const work = assertSeedWork(input);
      const validated = await validatePublicUrl(work.url, { resolve });

      return {
        candidates: [{
          sourceType: "seed_url",
          sourceIdentity: validated.canonicalUrl,
          sourceUrl: validated.observedUrl,
          observedUrl: validated.observedUrl,
          canonicalUrl: validated.canonicalUrl,
          observedName: null,
          observedLocation: null,
          providerRank: 1,
          metadata: { workId: work.id },
        }],
        nextCursor: { state: "exhausted" },
      };
    },
  };
}
