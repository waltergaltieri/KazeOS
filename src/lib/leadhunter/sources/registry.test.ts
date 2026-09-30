import { describe, expect, it, vi } from "vitest";

import { createSourceRegistry } from "./registry";

const publicResolver = vi.fn(async () => ["93.184.216.34"]);

describe("LeadHunter source registry", () => {
  it("reports live and unavailable sources explicitly without simulated results", () => {
    const registry = createSourceRegistry({ resolve: publicResolver });

    expect(registry.get("seed_url").capabilities).toMatchObject({
      discovery: true,
      live: true,
    });
    expect(registry.get("web_search").capabilities).toMatchObject({
      discovery: true,
      live: false,
      unavailableReason: expect.any(String),
    });
    for (const source of ["directories", "instagram", "linkedin", "csv", "manual"] as const) {
      expect(registry.get(source).capabilities).toMatchObject({
        live: false,
        unavailableReason: expect.any(String),
      });
    }
  });

  it("reports web search live only when a valid endpoint is configured", () => {
    const registry = createSourceRegistry({
      searxngEndpoint: "http://127.0.0.1:8888/search",
      resolve: publicResolver,
      fetch: vi.fn(),
    });

    expect(registry.get("web_search").capabilities).toMatchObject({
      discovery: true,
      supportsCursor: true,
      live: true,
    });
    expect(registry.list()).toHaveLength(7);
  });

  it("routes source-query and seed work to their real adapters", () => {
    const registry = createSourceRegistry({
      searxngEndpoint: "https://search.example.com/search",
      resolve: publicResolver,
      fetch: vi.fn(),
    });

    expect(registry.forWork({
      kind: "source_query",
      id: "q:1",
      source: "web_search",
      country: "AR",
      region: null,
      industry: null,
      query: "mayoristas",
      cursor: { state: "initial" },
      geographyEvidence: null,
    }).source).toBe("web_search");
    expect(registry.forWork({
      kind: "seed_url",
      id: "seed:1",
      url: "https://example.com",
    }).source).toBe("seed_url");
  });
});
