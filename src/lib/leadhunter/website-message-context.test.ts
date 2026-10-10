import { describe, expect, it } from "vitest";
import { websiteContextForMessage, type BriefEvidence } from "./message-brief";

function evidence(overrides = {}, observedAt = "2026-10-09T12:00:00Z"): BriefEvidence {
  return { id: "audit-evidence", field: "website_visual_review", status: "verified", confidence: 90,
    value: JSON.stringify({ type: "visual_review", status: "assessed", confidence: 90,
      observedAt, source: { sourceType: "website_scan", sourceUrl: "https://example.com" },
      model: "vision", summary: "Internal summary must not become an unsupported sales claim",
      screenshots: ["desktop", "mobile"].map(id => ({ id, viewport: id, sha256: "a".repeat(64), artifact: `visual/test/${id}.jpg` })),
      issues: [{ category: "mobile_layout", severity: "material", confidence: 90, screenshotId: "mobile",
        element: "Product text", observation: "Product text is clipped on mobile.", impact: "Speculative lost sales" }], ...overrides }) };
}
describe("website context for outreach", () => {
  it("passes observed defects with provenance without turning speculative impact into fact", () => {
    const context = websiteContextForMessage([evidence()]);
    expect(context?.findings).toEqual(["Product text is clipped on mobile."]);
    expect(context?.sourceUrl).toBe("https://example.com");
    expect(JSON.stringify(context)).not.toContain("lost sales");
  });
  it("does not reuse older defects when the latest assessment is unavailable", () => {
    expect(websiteContextForMessage([evidence(), evidence({ status: "unavailable", confidence: 0, issues: [] }, "2026-10-10T12:00:00Z")])?.findings).toEqual([]);
  });
  it("ignores malformed observations and low confidence defects", () => {
    expect(websiteContextForMessage([{ ...evidence(), value: "not JSON" }])).toBeUndefined();
    expect(websiteContextForMessage([evidence({ confidence: 60 })])?.findings).toEqual([]);
  });
});
