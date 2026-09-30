import { describe, expect, it } from "vitest";

import { campaignStrategySchema, createDefaultCampaignStrategy } from "./contracts";
import {
  evaluateQualification,
  qualificationAssessmentEnvelopeSchema,
  type QualificationAssessment,
  type QualificationEvidence,
  type QualificationInput,
} from "./qualification";

const evidenceIds = [
  "00000000-0000-5000-8000-000000000001",
  "00000000-0000-5000-8000-000000000002",
  "00000000-0000-5000-8000-000000000003",
  "00000000-0000-5000-8000-000000000004",
];

function evidence(
  id = evidenceIds[0]!,
  overrides: Partial<QualificationEvidence> = {},
): QualificationEvidence {
  return {
    id,
    questionKey: null,
    field: "observable_process",
    value: "Manual order entry",
    kind: "fact",
    status: "verified",
    confidence: 90,
    sourceType: "official_site",
    sourceUrl: "https://example.com/about",
    ...overrides,
  };
}

function assessment(
  criterion: string,
  outcome: QualificationAssessment["outcome"] = "met",
  confidence = 90,
  ids = [evidenceIds[0]!],
): QualificationAssessment {
  return { criterion, outcome, confidence, evidenceIds: ids };
}

function input(overrides: Partial<QualificationInput> = {}): QualificationInput {
  return {
    gates: [],
    rules: [{ criterion: "Tiene procesos manuales", weight: 80, effect: "score" }],
    researchQuestions: [],
    evidence: [evidence()],
    assessments: [assessment("Tiene procesos manuales")],
    websiteAudit: null,
    publishedEmailConfidence: 90,
    ...overrides,
  };
}

describe("LeadHunter qualification", () => {
  it("applies the documented deterministic score formula and ordering", () => {
    const result = evaluateQualification(input({
      researchQuestions: [{ key: "business_model", prompt: "Qué hace", required: true }],
      evidence: [
        evidence(),
        evidence(evidenceIds[1], {
          questionKey: "business_model",
          field: "business_model",
          value: "Wholesale distributor",
          confidence: 80,
        }),
      ],
    }));

    expect(result).toMatchObject({
      decision: "eligible",
      commercialFit: 95,
      evidenceConfidence: 85,
      businessStrength: 80,
      contactability: 90,
      score: 89,
    });
    expect(result.evidenceIds).toEqual([evidenceIds[0], evidenceIds[1]]);
    expect(result.gates).toContainEqual(expect.objectContaining({
      type: "research_required",
      key: "research:business_model",
      status: "passed",
    }));
  });

  it("rejects a good-enough website when the campaign website gate disallows it", () => {
    const result = evaluateQualification(input({
      gates: [{ type: "website", allowed: ["NO_WEBSITE", "BAD_WEBSITE"] }],
      evidence: [evidence(), evidence(evidenceIds[1])],
      websiteAudit: {
        gateResult: "GOOD_ENOUGH_WEBSITE",
        confidence: 95,
        evidenceIds: [evidenceIds[1]!],
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
      evidence: [evidence(), evidence(evidenceIds[1])],
      websiteAudit: {
        gateResult: "BAD_WEBSITE",
        confidence: 74,
        evidenceIds: [evidenceIds[1]!],
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
      evidence: [evidence(), evidence(evidenceIds[1])],
      websiteAudit: {
        gateResult: "GOOD_ENOUGH_WEBSITE",
        confidence: 95,
        evidenceIds: [evidenceIds[1]!],
      },
    }));

    expect(result.decision).toBe("eligible");
  });

  it("makes a verified evidence-backed explicit exclusion beat a high score", () => {
    const result = evaluateQualification(input({
      rules: [
        { criterion: "Tiene procesos manuales", weight: 100, effect: "score" },
        { criterion: "Ya es cliente", weight: -10, effect: "exclude" },
      ],
      evidence: [evidence(), evidence(evidenceIds[1])],
      assessments: [
        assessment("Tiene procesos manuales", "met", 100, [evidenceIds[0]!]),
        assessment("Ya es cliente", "met", 100, [evidenceIds[1]!]),
      ],
    }));

    expect(result.commercialFit).toBe(95);
    expect(result.decision).toBe("excluded");
    expect(result.reasons).toContain("explicit_exclusion:Ya es cliente");
  });

  it("derives assessment trust from persisted evidence and only lets worker confidence cap it", () => {
    const result = evaluateQualification(input({
      evidence: [evidence(evidenceIds[0], { confidence: 40 })],
      assessments: [assessment("Tiene procesos manuales", "met", 100)],
    }));

    expect(result.commercialFit).toBe(70);
    expect(result.evidenceConfidence).toBe(40);
    expect(result.score).toBe(47);
    expect(result.decision).toBe("excluded");
  });

  it("discounts inferred assessment evidence and never lets it trigger exclusion", () => {
    const result = evaluateQualification(input({
      rules: [{ criterion: "Ya es cliente", weight: -10, effect: "exclude" }],
      evidence: [evidence(evidenceIds[0], {
        kind: "hypothesis",
        status: "inferred",
        confidence: 100,
      })],
      assessments: [assessment("Ya es cliente", "met", 100)],
    }));

    expect(result.decision).toBe("needs_review");
    expect(result.evidenceConfidence).toBe(50);
    expect(result.reasons).toContain("exclusion_not_verified:Ya es cliente");
  });

  it("makes persisted conflicting assessment evidence require review despite a 100 claim", () => {
    const result = evaluateQualification(input({
      evidence: [evidence(evidenceIds[0], {
        kind: "hypothesis",
        status: "conflicting",
        confidence: 100,
      })],
      assessments: [assessment("Tiene procesos manuales", "met", 100)],
    }));

    expect(result.decision).toBe("needs_review");
    expect(result.evidenceConfidence).toBe(0);
    expect(result.reasons).toContain("assessment_evidence_conflicting:Tiene procesos manuales");
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
      evidence: [evidence(), evidence(evidenceIds[1], {
        questionKey: "service_opportunity",
        field: "service_opportunity",
        kind: "hypothesis",
        status: "conflicting",
        confidence: 95,
      })],
    })).decision).toBe("needs_review");
    expect(evaluateQualification(input({
      gates: [gate],
      evidence: [evidence(), evidence(evidenceIds[1], {
        questionKey: "service_opportunity",
        field: "service_opportunity",
        confidence: 85,
      })],
    })).decision).toBe("eligible");
  });

  it("blocks each missing or conflicting required default research question", () => {
    const strategy = createDefaultCampaignStrategy({
      objective: "Buscar distribuidores",
      serviceFocus: "custom_management",
      countries: ["AR"],
      sources: ["web_search"],
      positiveCriteria: ["Tiene procesos manuales"],
      negativeCriteria: [],
    });
    const requiredKeys = strategy.research.questions
      .filter(({ required }) => required)
      .map(({ key }) => key);

    const missing = evaluateQualification(input({
      researchQuestions: strategy.research.questions,
    }));
    expect(missing.decision).toBe("needs_review");
    expect(missing.gates.filter(({ status }) => status === "needs_review").map(({ key }) => key))
      .toEqual(requiredKeys.map((key) => `research:${key}`).sort());

    const conflicting = evaluateQualification(input({
      researchQuestions: strategy.research.questions,
      evidence: [
        evidence(),
        ...requiredKeys.map((key, index) => evidence(evidenceIds[index + 1]!, {
          questionKey: key,
          field: key,
          value: `${key} answer`,
          kind: key === "digital_presence" ? "hypothesis" : "fact",
          status: key === "digital_presence" ? "conflicting" : "verified",
          confidence: 95,
        })),
      ],
    }));
    expect(conflicting.decision).toBe("needs_review");
    expect(conflicting.gates).toContainEqual(expect.objectContaining({
      key: "research:digital_presence",
      status: "needs_review",
      reason: "required_research_conflicting",
    }));
  });

  it("allows only high-confidence non-conflicting inference for a required research answer", () => {
    const question = [{ key: "business_model", prompt: "Qué hace", required: true }];
    const low = evaluateQualification(input({
      researchQuestions: question,
      evidence: [evidence(), evidence(evidenceIds[1], {
        questionKey: "business_model", field: "business_model",
        kind: "hypothesis", status: "inferred", confidence: 89,
      })],
    }));
    const high = evaluateQualification(input({
      researchQuestions: question,
      evidence: [evidence(), evidence(evidenceIds[1], {
        questionKey: "business_model", field: "business_model",
        kind: "hypothesis", status: "inferred", confidence: 90,
      })],
    }));

    expect(low.decision).toBe("needs_review");
    expect(high.gates).toContainEqual(expect.objectContaining({
      key: "research:business_model", status: "passed",
      reason: "required_research_inferred",
    }));
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
