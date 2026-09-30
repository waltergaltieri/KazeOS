import { describe, expect, it } from "vitest";

import {
  deriveWebsiteAuditObservations,
  evaluateWebsiteAudit,
  websiteAuditEnvelopeSchema,
  type WebsiteAuditObservation,
  type WebsiteAuditCheck,
} from "./website-audit";

const observedAt = "2026-09-30T12:00:00.000Z";
const evidence = [
  "00000000-0000-5000-8000-000000000001",
  "00000000-0000-5000-8000-000000000002",
  "00000000-0000-5000-8000-000000000003",
  "00000000-0000-5000-8000-000000000004",
  "00000000-0000-5000-8000-000000000005",
];

function check(
  key: WebsiteAuditCheck["key"],
  outcome: WebsiteAuditCheck["outcome"],
  index: number,
  overrides: Partial<WebsiteAuditCheck> = {},
): WebsiteAuditCheck {
  return {
    key,
    category: "presence",
    outcome,
    severity: "material",
    confidence: 90,
    observedAt,
    evidenceIds: [evidence[index]!],
    source: {
      sourceType: "official_site",
      sourceUrl: `https://example.com/source-${index}`,
    },
    ...overrides,
  };
}

const verifiedWebsite = { website: "https://example.com" } as const;
const verifiedNoWebsite = { website: null } as const;

type ObservationWithoutTime = WebsiteAuditObservation extends infer Observation
  ? Observation extends { observedAt: string }
    ? Omit<Observation, "observedAt">
    : never
  : never;

function observation(input: ObservationWithoutTime): WebsiteAuditObservation {
  return { ...input, observedAt } as WebsiteAuditObservation;
}

function deriveAndEvaluate(
  observations: WebsiteAuditObservation[],
  website: string | null,
) {
  const derived = deriveWebsiteAuditObservations(observations, {
    namespace: "audit-job-1",
    website,
  });
  return {
    derived,
    result: evaluateWebsiteAudit(derived.checks, {
      website,
      allowedWebsiteOrigins: derived.allowedWebsiteOrigins,
      contextEvidenceIds: derived.contextEvidenceIds,
    }),
  };
}

describe("LeadHunter website audit", () => {
  it("classifies no official site only with independent active-presence evidence", () => {
    const result = evaluateWebsiteAudit([
      check("official_site", "fail", 0, {
        source: {
          sourceType: "directory",
          sourceUrl: "https://directory.example/acme",
        },
      }),
      check("active_commercial_presence", "pass", 1, {
        source: {
          sourceType: "instagram",
          sourceUrl: "https://instagram.com/acme",
        },
      }),
    ], verifiedNoWebsite);

    expect(result).toMatchObject({
      gateResult: "NO_WEBSITE",
      confidence: 90,
      reasons: ["official_site_absent_with_active_presence"],
    });
    expect(result.evidenceIds).toEqual([evidence[0], evidence[1]]);
  });

  it("does not equate a missing URL with verified absence", () => {
    expect(evaluateWebsiteAudit([
      check("official_site", "unknown", 0),
      check("active_commercial_presence", "pass", 1),
    ], verifiedNoWebsite).gateResult).toBe("UNVERIFIED");
  });

  it("requires corroborating material failures before classifying a site as bad", () => {
    const result = evaluateWebsiteAudit([
      check("page_integrity", "fail", 0, { category: "reliability" }),
      check("critical_content", "fail", 1, {
        category: "content",
        source: {
          sourceType: "website_scan",
          sourceUrl: "https://example.com/source-1",
        },
      }),
    ], verifiedWebsite);

    expect(result.gateResult).toBe("BAD_WEBSITE");
    expect(result.reasons).toEqual([
      "material_failure:critical_content",
      "material_failure:page_integrity",
    ]);
  });

  it.each([
    "copyright_current" as const,
    "wordpress" as const,
    "technology_recency" as const,
    "typography" as const,
    "aesthetic" as const,
    "ecommerce" as const,
  ])("keeps subjective or non-material %s evidence unverified", (key) => {
    const result = evaluateWebsiteAudit([
      check(key, "fail", 0, { severity: "critical", category: "presentation" }),
    ], verifiedWebsite);

    expect(result.gateResult).toBe("UNVERIFIED");
  });

  it("classifies a verified usable and current commercial site as good enough", () => {
    const result = evaluateWebsiteAudit([
      check("official_site", "pass", 0),
      check("reachable", "pass", 1, { category: "reliability" }),
      check("critical_content", "pass", 2, { category: "content" }),
      check("navigation", "pass", 3, { category: "usability" }),
      check("critical_information_freshness", "pass", 4, { category: "freshness" }),
    ], verifiedWebsite);

    expect(result).toMatchObject({
      gateResult: "GOOD_ENOUGH_WEBSITE",
      confidence: 90,
      reasons: ["verified_reachable_usable_current_site"],
    });
  });

  it("keeps missing, conflicting, reused or low-confidence material checks unverified", () => {
    const conflicting = evaluateWebsiteAudit([
      check("official_site", "pass", 0),
      check("official_site", "fail", 1),
      check("reachable", "pass", 2),
      check("critical_content", "pass", 3),
      check("navigation", "pass", 4),
    ], verifiedWebsite);
    expect(conflicting.gateResult).toBe("UNVERIFIED");
    expect(conflicting.reasons).toContain("conflicting_check:official_site");

    const reusedEvidence = evaluateWebsiteAudit([
      check("page_integrity", "fail", 0),
      check("critical_content", "fail", 0),
    ], verifiedWebsite);
    expect(reusedEvidence.gateResult).toBe("UNVERIFIED");

    const lowConfidence = evaluateWebsiteAudit([
      check("page_integrity", "fail", 0, { confidence: 74 }),
      check("critical_content", "fail", 1),
    ], verifiedWebsite);
    expect(lowConfidence.gateResult).toBe("UNVERIFIED");
  });

  it("deduplicates exact observations and orders checks and evidence deterministically", () => {
    const first = check("critical_content", "fail", 1, { category: "content" });
    const second = check("page_integrity", "fail", 0, { category: "reliability" });
    const result = evaluateWebsiteAudit([first, second, first], verifiedWebsite);

    expect(result.checks).toHaveLength(2);
    expect(result.checks.map(({ key }) => key)).toEqual([
      "critical_content",
      "page_integrity",
    ]);
    expect(result.evidenceIds).toEqual([evidence[0], evidence[1]]);
  });

  it("does not treat two observations from the same normalized source as corroboration", () => {
    const noWebsite = evaluateWebsiteAudit([
      check("official_site", "fail", 0, {
        source: { sourceType: "directory", sourceUrl: "https://DIRECTORY.example/a" },
      }),
      check("active_commercial_presence", "pass", 1, {
        source: { sourceType: "directory", sourceUrl: "https://directory.example/b" },
      }),
    ], verifiedNoWebsite);
    const badWebsite = evaluateWebsiteAudit([
      check("page_integrity", "fail", 0, {
        source: { sourceType: "official_site", sourceUrl: "https://example.com/a" },
      }),
      check("critical_content", "fail", 1, {
        source: { sourceType: "official_site", sourceUrl: "https://EXAMPLE.com/b" },
      }),
    ], verifiedWebsite);

    expect(noWebsite.gateResult).toBe("UNVERIFIED");
    expect(badWebsite.gateResult).toBe("UNVERIFIED");
  });

  it("does not classify present-site checks against another website origin", () => {
    const result = evaluateWebsiteAudit([
      check("page_integrity", "fail", 0, {
        source: { sourceType: "website_scan", sourceUrl: "https://other.example/a" },
      }),
      check("critical_content", "fail", 1, {
        source: { sourceType: "official_site", sourceUrl: "https://other.example/b" },
      }),
    ], verifiedWebsite);

    expect(result.gateResult).toBe("UNVERIFIED");
    expect(result.reasons).toContain("website_target_mismatch");
  });

  it("accepts a different site origin only when trusted redirect context allows it", () => {
    const checks = [
      check("page_integrity", "fail", 0, {
        source: { sourceType: "website_scan", sourceUrl: "https://redirected.example/a" },
      }),
      check("critical_content", "fail", 1, {
        source: { sourceType: "official_site", sourceUrl: "https://redirected.example/b" },
      }),
    ];

    expect(evaluateWebsiteAudit(checks, verifiedWebsite).gateResult).toBe("UNVERIFIED");
    expect(evaluateWebsiteAudit(checks, {
      ...verifiedWebsite,
      allowedWebsiteOrigins: ["https://redirected.example"],
    }).gateResult).toBe("BAD_WEBSITE");
  });

  it("requires an explicit null target before classifying no website", () => {
    const checks = [
      check("official_site", "fail", 0, {
        source: { sourceType: "directory", sourceUrl: "https://directory.example/a" },
      }),
      check("active_commercial_presence", "pass", 1, {
        source: { sourceType: "instagram", sourceUrl: "https://instagram.com/acme" },
      }),
    ];

    expect(evaluateWebsiteAudit(checks, { website: undefined }).gateResult)
      .toBe("UNVERIFIED");
    expect(evaluateWebsiteAudit(checks, verifiedNoWebsite).gateResult)
      .toBe("NO_WEBSITE");
  });

  it("derives all terminal states from bounded typed observations", () => {
    const noWebsite = deriveAndEvaluate([
      observation({
        type: "official_site", state: "absent", targetUrl: null,
        source: { sourceType: "directory", sourceUrl: "https://directory.example/acme" },
      }),
      observation({
        type: "active_commercial_presence", active: true,
        source: { sourceType: "instagram", sourceUrl: "https://instagram.com/acme" },
      }),
    ], null);
    const badWebsite = deriveAndEvaluate([
      observation({
        type: "page_integrity", checkedPages: 5, brokenPages: 3,
        source: { sourceType: "website_scan", sourceUrl: "https://example.com/scan" },
      }),
      observation({
        type: "critical_content", requiredItems: ["services", "contact"], missingItems: ["contact"],
        source: { sourceType: "official_site", sourceUrl: "https://example.com/" },
      }),
    ], "https://example.com");
    const goodWebsite = deriveAndEvaluate([
      observation({
        type: "official_site", state: "present", targetUrl: "https://example.com",
        source: { sourceType: "official_site", sourceUrl: "https://example.com/" },
      }),
      observation({
        type: "reachability", state: "reachable", statusCode: 200, error: null,
        source: { sourceType: "http_probe", sourceUrl: "https://example.com/" },
      }),
      observation({
        type: "critical_content", requiredItems: ["services", "contact"], missingItems: [],
        source: { sourceType: "website_scan", sourceUrl: "https://example.com/content" },
      }),
      observation({
        type: "navigation", testedPaths: 5, brokenPaths: 0,
        source: { sourceType: "website_scan", sourceUrl: "https://example.com/navigation" },
      }),
      observation({
        type: "critical_information_freshness", checkedCriticalItems: 2, staleCriticalItems: 0,
        source: { sourceType: "official_site", sourceUrl: "https://example.com/about" },
      }),
    ], "https://example.com");
    const unverified = deriveAndEvaluate([
      observation({
        type: "subjective", key: "aesthetic", note: "Looks dated",
        source: { sourceType: "website_scan", sourceUrl: "https://example.com/" },
      }),
    ], "https://example.com");

    expect(noWebsite.result.gateResult).toBe("NO_WEBSITE");
    expect(badWebsite.result.gateResult).toBe("BAD_WEBSITE");
    expect(goodWebsite.result.gateResult).toBe("GOOD_ENOUGH_WEBSITE");
    expect(unverified.result.gateResult).toBe("UNVERIFIED");
    expect(unverified.derived.checks[0]).toMatchObject({
      outcome: "unknown", severity: "informational", confidence: 0,
    });
  });

  it("creates stable canonical evidence and treats redirect as an audit observation", () => {
    const observations = [
      observation({
        type: "redirect", fromUrl: "https://example.com", toUrl: "https://new.example.com",
        permanent: true,
        source: { sourceType: "http_probe", sourceUrl: "https://example.com" },
      }),
      observation({
        type: "reachability", state: "unreachable", statusCode: null, error: "timeout",
        source: { sourceType: "http_probe", sourceUrl: "https://new.example.com" },
      }),
      observation({
        type: "critical_content", requiredItems: ["contact"], missingItems: ["contact"],
        source: { sourceType: "website_scan", sourceUrl: "https://new.example.com" },
      }),
    ];
    const first = deriveWebsiteAuditObservations(observations, {
      namespace: "audit-job-1", website: "https://example.com",
    });
    const second = deriveWebsiteAuditObservations([...observations].reverse(), {
      namespace: "audit-job-1", website: "https://example.com",
    });

    expect(second).toEqual(first);
    expect(first.evidence).toContainEqual(expect.objectContaining({
      field: "website_redirect_target",
      confidence: 95,
    }));
    expect(first.evidence.every(({ field }) => !field.includes("."))).toBe(true);
    expect(evaluateWebsiteAudit(first.checks, {
      website: "https://example.com",
      allowedWebsiteOrigins: first.allowedWebsiteOrigins,
      contextEvidenceIds: first.contextEvidenceIds,
    }).gateResult).toBe("BAD_WEBSITE");
    expect(first.contextEvidenceIds).toHaveLength(1);
  });

  it("rejects cross-origin redirects and downgrades mismatched site observations", () => {
    expect(() => deriveWebsiteAuditObservations([
      observation({
        type: "redirect", fromUrl: "https://other.example", toUrl: "https://new.example",
        permanent: true,
        source: { sourceType: "http_probe", sourceUrl: "https://other.example" },
      }),
    ], { namespace: "audit-job-1", website: "https://example.com" })).toThrow(/trusted website/i);

    const { result } = deriveAndEvaluate([
      observation({
        type: "reachability", state: "unreachable", statusCode: null, error: "timeout",
        source: { sourceType: "http_probe", sourceUrl: "https://other.example" },
      }),
      observation({
        type: "critical_content", requiredItems: ["contact"], missingItems: ["contact"],
        source: { sourceType: "website_scan", sourceUrl: "https://other.example" },
      }),
    ], "https://example.com");
    expect(result.gateResult).toBe("UNVERIFIED");
    expect(result.reasons).toContain("website_target_mismatch");
  });

  it("strictly bounds typed observation envelopes and rejects worker outcomes", () => {
    const reachable = observation({
      type: "reachability", state: "reachable", statusCode: 200, error: null,
      source: { sourceType: "http_probe", sourceUrl: "https://example.com" },
    });
    expect(websiteAuditEnvelopeSchema.safeParse({
      observations: [reachable],
    }).success).toBe(true);
    expect(websiteAuditEnvelopeSchema.safeParse({
      observations: [{ ...reachable, outcome: "pass", severity: "material" }],
    }).success).toBe(false);
    expect(websiteAuditEnvelopeSchema.safeParse({
      checks: [check("reachable", "pass", 0)],
    }).success).toBe(false);
    expect(websiteAuditEnvelopeSchema.safeParse({ observations: [{
      ...reachable,
      statusCode: null,
    }] }).success).toBe(false);
    expect(websiteAuditEnvelopeSchema.safeParse({ observations: Array(101).fill(
      reachable,
    ) }).success).toBe(false);
  });
});
