import { describe, expect, it } from "vitest";

import {
  evaluateWebsiteAudit,
  websiteAuditEnvelopeSchema,
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

  it("strictly bounds observation envelopes and requires evidence source context", () => {
    expect(websiteAuditEnvelopeSchema.safeParse({
      checks: [check("reachable", "pass", 0)],
    }).success).toBe(true);
    expect(websiteAuditEnvelopeSchema.safeParse({
      checks: [{ ...check("reachable", "pass", 0), sendMail: true }],
    }).success).toBe(false);
    expect(websiteAuditEnvelopeSchema.safeParse({
      checks: [{ ...check("reachable", "pass", 0), evidenceIds: [] }],
    }).success).toBe(false);
    expect(websiteAuditEnvelopeSchema.safeParse({ checks: Array(101).fill(
      check("reachable", "pass", 0),
    ) }).success).toBe(false);
  });
});
