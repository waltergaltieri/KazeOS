import { describe, expect, it } from "vitest";

import { campaignStrategySchema, createDefaultCampaignStrategy } from "./contracts";
import {
  evaluateQualification,
  maximumQualificationEvidenceIds,
  maximumQualificationGateResults,
  maximumQualificationReasons,
  qualificationAssessmentEnvelopeSchema,
  qualificationResultSchema,
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

function input(overrides: Partial<QualificationInput> = {}): QualificationInput {
  return {
    gates: [],
    rules: [{
      criterion: "Tiene procesos manuales",
      weight: 80,
      effect: "score",
      predicate: {
        field: "observable_process",
        operator: "verified_exists",
        minimumConfidence: 75,
      },
    }],
    researchQuestions: [],
    evidence: [evidence()],
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
        {
          criterion: "Tiene procesos manuales", weight: 100, effect: "score",
          predicate: { field: "observable_process", operator: "verified_exists", minimumConfidence: 75 },
        },
        {
          criterion: "Ya es cliente", weight: -10, effect: "exclude",
          predicate: { field: "existing_client", operator: "normalized_equals", expected: "yes", minimumConfidence: 75 },
        },
      ],
      evidence: [evidence(), evidence(evidenceIds[1], { field: "existing_client", value: "yes" })],
    }));

    expect(result.commercialFit).toBe(95);
    expect(result.decision).toBe("excluded");
    expect(result.reasons).toContain("explicit_exclusion:Ya es cliente");
  });

  it("requires persisted facts to meet the configured predicate confidence", () => {
    const result = evaluateQualification(input({
      evidence: [evidence(evidenceIds[0], { confidence: 40 })],
    }));

    expect(result.commercialFit).toBe(50);
    expect(result.evidenceConfidence).toBe(0);
    expect(result.decision).toBe("needs_review");
    expect(result.reasons).toContain("rule_evidence_missing:Tiene procesos manuales");
  });

  it("never lets inferred evidence trigger exclusion", () => {
    const result = evaluateQualification(input({
      rules: [{
        criterion: "Ya es cliente", weight: -10, effect: "exclude",
        predicate: { field: "existing_client", operator: "normalized_equals", expected: "yes", minimumConfidence: 75 },
      }],
      evidence: [evidence(evidenceIds[0], {
        field: "existing_client",
        value: "yes",
        kind: "hypothesis",
        status: "inferred",
        confidence: 100,
      })],
    }));

    expect(result.decision).toBe("needs_review");
    expect(result.evidenceConfidence).toBe(0);
    expect(result.reasons).toContain("rule_evidence_missing:Ya es cliente");
  });

  it("makes persisted conflicting predicate evidence require review", () => {
    const result = evaluateQualification(input({
      evidence: [evidence(evidenceIds[0], {
        kind: "hypothesis",
        status: "conflicting",
        confidence: 100,
      })],
    }));

    expect(result.decision).toBe("needs_review");
    expect(result.evidenceConfidence).toBe(0);
    expect(result.reasons).toContain("rule_evidence_conflicting:Tiene procesos manuales");
  });

  it("treats an inferred value that contradicts a verified predicate value as conflicting", () => {
    const result = evaluateQualification(input({
      rules: [{
        criterion: "Ya es cliente", weight: -10, effect: "exclude",
        predicate: {
          field: "existing_client", operator: "normalized_equals",
          expected: "yes", minimumConfidence: 75,
        },
      }],
      evidence: [
        evidence(evidenceIds[0], { field: "existing_client", value: "yes" }),
        evidence(evidenceIds[1], {
          field: "existing_client", value: "no",
          kind: "hypothesis", status: "inferred", confidence: 100,
        }),
      ],
    }));

    expect(result.decision).toBe("needs_review");
    expect(result.reasons).toContain("rule_evidence_conflicting:Ya es cliente");
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

  it("keeps legacy free-text rules on a conservative review path", () => {
    const result = evaluateQualification(input({
      rules: [{ criterion: "Tiene procesos manuales", weight: 100, effect: "score" }],
    }));

    expect(result.decision).toBe("needs_review");
    expect(result.commercialFit).toBe(50);
    expect(result.reasons).toContain("unstructured_rule:Tiene procesos manuales");
  });

  it("accepts only an empty trigger envelope and no worker decision data", () => {
    expect(qualificationAssessmentEnvelopeSchema.safeParse({}).success).toBe(true);
    expect(qualificationAssessmentEnvelopeSchema.safeParse({
      decision: "eligible",
    }).success).toBe(false);
    expect(qualificationAssessmentEnvelopeSchema.safeParse({
      assessments: [],
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

  it("losslessly validates the maximum contract-sized qualification result", () => {
    const questions = Array.from({ length: 100 }, (_, index) => ({
      key: `required_${index}`,
      prompt: `Required question ${index}`,
      required: true,
    }));
    const persistedEvidence = Array.from({ length: 500 }, (_, index) => evidence(
      `00000000-0000-5000-8000-${(index + 1).toString().padStart(12, "0")}`,
      {
        questionKey: `required_${Math.floor(index / 5)}`,
        field: `required_${Math.floor(index / 5)}`,
        value: `answer_${Math.floor(index / 5)}`,
        confidence: 100,
      },
    ));
    const result = evaluateQualification(input({
      gates: Array.from({ length: 50 }, () => ({
        type: "website" as const,
        allowed: ["GOOD_ENOUGH_WEBSITE" as const],
      })),
      researchQuestions: questions,
      evidence: persistedEvidence,
      rules: [{
        criterion: "Tiene procesos manuales", weight: 80, effect: "score",
        predicate: { field: "required_0", operator: "verified_exists", minimumConfidence: 75 },
      }],
      websiteAudit: {
        gateResult: "GOOD_ENOUGH_WEBSITE",
        confidence: 100,
        evidenceIds: [persistedEvidence[0]!.id],
      },
    }));

    expect(maximumQualificationGateResults).toBe(150);
    expect(maximumQualificationReasons).toBe(250);
    expect(maximumQualificationEvidenceIds).toBe(500);
    expect(result.gates).toHaveLength(maximumQualificationGateResults);
    expect(result.evidenceIds).toHaveLength(maximumQualificationEvidenceIds);
    expect(qualificationResultSchema.safeParse(result).success).toBe(true);

    expect(qualificationResultSchema.safeParse({
      ...result,
      gates: [...result.gates, result.gates[0]],
    }).success).toBe(false);
    expect(qualificationResultSchema.safeParse({
      ...result,
      reasons: Array.from({ length: maximumQualificationReasons + 1 }, (_, index) => `r${index}`),
    }).success).toBe(false);
    const excessIds = Array.from(
      { length: maximumQualificationEvidenceIds + 1 },
      (_, index) => `00000000-0000-5000-8001-${index.toString().padStart(12, "0")}`,
    );
    expect(qualificationResultSchema.safeParse({
      ...result,
      evidenceIds: excessIds,
    }).success).toBe(false);
    expect(qualificationResultSchema.safeParse({
      ...result,
      gates: [{ ...result.gates[0], evidenceIds: excessIds }],
    }).success).toBe(false);
  });

  it("rejects qualification inputs beyond their independent contract maxima", () => {
    const websiteGate = {
      type: "website" as const,
      allowed: ["GOOD_ENOUGH_WEBSITE" as const],
    };
    expect(() => evaluateQualification(input({
      gates: Array.from({ length: 51 }, () => websiteGate),
    }))).toThrow();
    expect(() => evaluateQualification(input({
      researchQuestions: Array.from({ length: 101 }, (_, index) => ({
        key: `required_${index}`,
        prompt: `Required question ${index}`,
        required: true,
      })),
    }))).toThrow();
    expect(() => evaluateQualification(input({
      evidence: Array.from({ length: 501 }, (_, index) => evidence(
        `00000000-0000-5000-8002-${index.toString().padStart(12, "0")}`,
      )),
    }))).toThrow();
  });
});
