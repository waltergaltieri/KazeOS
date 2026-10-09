import { describe, expect, it } from "vitest";
import { deriveWebsiteAuditObservations, evaluateWebsiteAudit, websiteAuditEnvelopeSchema } from "./website-audit";

function assess(issues: unknown[], overrides = {}) {
  const observations = websiteAuditEnvelopeSchema.parse({ observations: [{
    type: "visual_review", observedAt: "2026-10-09T12:00:00Z",
    source: { sourceType: "website_scan", sourceUrl: "https://example.com/" },
    status: "assessed", confidence: 90, summary: "Rendered desktop and mobile review", model: "MiniMax-M3",
    screenshots: ["desktop", "mobile"].map(id => ({ id, viewport: id, sha256: "a".repeat(64), artifact: `visual/test/${id}.jpg` })),
    issues, ...overrides,
  }] }).observations;
  const derived = deriveWebsiteAuditObservations(observations, { namespace: "test", website: "https://example.com/" });
  return evaluateWebsiteAudit(derived.checks, { website: "https://example.com/", allowedWebsiteOrigins: derived.allowedWebsiteOrigins, contextEvidenceIds: derived.contextEvidenceIds });
}
const issue = (category: string, screenshotId = "mobile", severity = "material") => ({
  category, screenshotId, severity, confidence: 90, element: "Product cards", observation: "Text is clipped outside the viewport", impact: "Product descriptions cannot be read",
});
describe("screenshot-backed visual qualification", () => {
  it("rejects a usable but materially broken presentation", () => {
    expect(assess([issue("mobile_layout"), issue("legibility")]).gateResult).toBe("BAD_WEBSITE");
  });
  it("does not disqualify a site merely for an older style", () => {
    expect(assess([issue("dated_presentation", "desktop", "minor")]).gateResult).toBe("GOOD_ENOUGH_WEBSITE");
  });
  it("keeps unavailable captures in review", () => {
    expect(assess([], { status: "unavailable", confidence: 0, screenshots: [] }).gateResult).toBe("UNVERIFIED");
  });
  it("rejects nonexistent screenshot references", () => {
    expect(() => assess([issue("legibility", "invented")])).toThrow();
  });
  it("never approves a single viewport as a complete review", () => {
    expect(assess([], { screenshots: [{ id: "desktop", viewport: "desktop", sha256: "a".repeat(64), artifact: "visual/test/a.jpg" }] }).gateResult).toBe("UNVERIFIED");
  });
});
