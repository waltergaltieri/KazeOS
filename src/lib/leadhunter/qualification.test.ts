import { describe, expect, it } from "vitest";

import { campaignStrategySchema } from "./contracts";
import {
  evaluateQualification,
  qualificationAssessmentEnvelopeSchema,
  type QualificationAssessment,
  type QualificationInput,
} from "./qualification";

const evidence = [
  "00000000-0000-5000-8000-000000000001",
  "00000000-0000-5000-8000-000000000002",
  "00000000-0000-5000-8000-000000000003",
];

function assessment(
  criterion: string,
  outcome: QualificationAssessment["outcome"] = "met",
  confidence = 90,
  evidenceIds = [evidence[0]!],
): QualificationAssessment {
  return { criterion, outcome, confidence, evidenceIds };
}

function input(overrides: Partial<QualificationInput> = {}): QualificationInput {
  return {
    gates: [],
    rules: [{ criterion: "Tiene procesos manuales", weight: 80, effect: "score" }],
    findings: [],
    assessments: [assessment("Tiene procesos manuales")],
    knownEvidenceIds: evidence,
    websiteAudit: null,
    publishedEmailConfidence: 90,
    ...overrides,
  };
}

describe("LeadHunter qualification", () => {
  it("applies the documented deterministic score formula and ordering", () => {
    const result = evaluateQualification(input({
      findings: [{
        key: "business_model",
        status: "verified",
        confidence: 80,
        evidenceIds: [evidence[1]!],
      }],
    }));

    expect(result).toMatchObject({
      decision: "eligible",
      commercialFit: 95,
      evidenceConfidence: 85,
      businessStrength: 80,
      contactability: 90,
      score: 89,
    });
    expect(result.evidenceIds).toEqual([evidence[0], evidence[1]]);
  });

  it("rejects a good-enough website when the campaign website gate disallows it", () => {
    const result = evaluateQualification(input({
      gates: [{ type: "website", allowed: ["NO_WEBSITE", "BAD_WEBSITE"] }],
      websiteAudit: {
        gateResult: "GOOD_ENOUGH_WEBSITE",
        confidence: 95,
        evidenceIds: [evidence[1]!],
      },
    }));

    expect(result.decision).toBe("excluded");
    expect(result.gates).toEqual([
      expect.objectContaining({ type: "website", status: "failed" }),
    ]);
  });

  it("keeps a low-confidence website classification in review", () => {
    const result = evaluateQualification(input({
      gates: [{ type: "website", allowed: ["BAD_WEBSITE"] }],
      websiteAudit: {
        gateResult: "BAD_WEBSITE",
        confidence: 74,
        evidenceIds: [evidence[1]!],
      },
    }));

    expect(result.decision).toBe("needs_review");
    expect(result.gates[0]).toMatchObject({
      status: "needs_review",
      reason: "website_gate_unverified",
    });
  });

  it("allows the same business to qualify for another campaign without a website gate", () => {
    const result = evaluateQualification(input({
      websiteAudit: {
        gateResult: "GOOD_ENOUGH_WEBSITE",
        confidence: 95,
        evidenceIds: [evidence[1]!],
      },
    }));

    expect(result.decision).toBe("eligible");
  });

  it("makes an evidence-backed explicit exclusion beat a high score", () => {
    const result = evaluateQualification(input({
      rules: [
        { criterion: "Tiene procesos manuales", weight: 100, effect: "score" },
        { criterion: "Ya es cliente", weight: -10, effect: "exclude" },
      ],
      assessments: [
        assessment("Tiene procesos manuales", "met", 100, [evidence[0]!]),
        assessment("Ya es cliente", "met", 100, [evidence[1]!]),
      ],
    }));

    expect(result.commercialFit).toBe(100);
    expect(result.decision).toBe("excluded");
    expect(result.reasons).toContain("explicit_exclusion:Ya es cliente");
  });

  it("keeps contactability separate from commercial merit", () => {
    const result = evaluateQualification(input({ publishedEmailConfidence: null }));

    expect(result.decision).toBe("no_email");
    expect(result.commercialFit).toBe(95);
    expect(result.contactability).toBe(0);
  });

  it("requires verified non-conflicting evidence for required finding gates", () => {
    const gate = {
      type: "required_finding" as const,
      field: "service_opportunity",
      minimumConfidence: 80,
    };

    expect(evaluateQualification(input({ gates: [gate] })).decision).toBe("needs_review");
    expect(evaluateQualification(input({
      gates: [gate],
      findings: [{
        key: "service_opportunity",
        status: "conflicting",
        confidence: 95,
        evidenceIds: [evidence[1]!],
      }],
    })).decision).toBe("needs_review");
    expect(evaluateQualification(input({
      gates: [gate],
      findings: [{
        key: "service_opportunity",
        status: "verified",
        confidence: 85,
        evidenceIds: [evidence[1]!],
      }],
    })).decision).toBe("eligible");
  });

  it("rejects unsupported, duplicate and unowned criterion evidence at the boundary", () => {
    expect(() => evaluateQualification(input({
      assessments: [assessment("Not configured")],
    }))).toThrow(/configured criterion/i);
    expect(() => evaluateQualification(input({
      assessments: [
        assessment("Tiene procesos manuales"),
        assessment(" tiene  procesos MANUALES "),
      ],
    }))).toThrow(/duplicate/i);
    expect(() => evaluateQualification(input({
      assessments: [assessment(
        "Tiene procesos manuales",
        "met",
        90,
        ["00000000-0000-5000-8000-000000000099"],
      )],
    }))).toThrow(/owned evidence/i);
  });

  it("strictly bounds the non-authoritative assessment envelope", () => {
    expect(qualificationAssessmentEnvelopeSchema.safeParse({
      assessments: [assessment("Tiene procesos manuales")],
    }).success).toBe(true);
    expect(qualificationAssessmentEnvelopeSchema.safeParse({
      assessments: [assessment("Tiene procesos manuales")],
      decision: "eligible",
    }).success).toBe(false);
  });

  it("defaults legacy weighted rules to score and preserves explicit exclusion", () => {
    const qualification = campaignStrategySchema.shape.qualification.parse({
      gates: [],
      rules: [
        { criterion: "Proceso manual", weight: 10 },
        { criterion: "Ya es cliente", weight: -10, effect: "exclude" },
      ],
    });

    expect(qualification.rules).toEqual([
      { criterion: "Proceso manual", weight: 10, effect: "score" },
      { criterion: "Ya es cliente", weight: -10, effect: "exclude" },
    ]);
  });
});
