import { describe, expect, it, vi } from "vitest";

import { SafeUrlError } from "../safe-url";
import type { SeedUrlWorkItem } from "./contracts";
import { createSeedUrlAdapter } from "./seed-urls";

const publicResolver = vi.fn(async () => ["93.184.216.34"]);

describe("seed URL source adapter", () => {
  it("turns an exact campaign URL into a normalized discovery candidate", async () => {
    const adapter = createSeedUrlAdapter({ resolve: publicResolver });
    const work = {
      kind: "seed_url",
      id: "seed:1",
      url: "HTTPS://Example.COM:443/catalog/?utm_source=campaign#top",
    } satisfies SeedUrlWorkItem;

    await expect(adapter.discover(work)).resolves.toEqual({
      candidates: [{
        sourceType: "seed_url",
        sourceIdentity: "https://example.com/catalog",
        sourceUrl: work.url,
        observedUrl: work.url,
        canonicalUrl: "https://example.com/catalog",
        observedName: null,
        observedLocation: null,
        providerRank: 1,
        metadata: { workId: "seed:1" },
      }],
      nextCursor: { state: "exhausted" },
    });
    expect(adapter.capabilities).toEqual({
      discovery: true,
      enrichment: false,
      contactSearch: false,
      supportsCursor: false,
      live: true,
    });
  });

  it("rejects a campaign seed that is not public", async () => {
    const adapter = createSeedUrlAdapter({ resolve: publicResolver });

    await expect(adapter.discover({
      kind: "seed_url",
      id: "seed:private",
      url: "http://192.168.1.10/admin",
    })).rejects.toBeInstanceOf(SafeUrlError);
  });
});
