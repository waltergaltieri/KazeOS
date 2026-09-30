import { z } from "zod";

import {
  qualificationGateSchema,
  qualificationRuleSchema,
  websiteGateStateSchema,
  type QualificationGate,
  type QualificationRule,
} from "./contracts";

const evidenceIdsSchema = z.array(z.string().uuid()).min(1).max(20).transform(
  (values) => [...new Set(values)].sort(),
);

export const qualificationAssessmentSchema = z.object({
  criterion: z.string().trim().min(1).max(240),
  outcome: z.enum(["met", "not_met", "unknown", "conflicting"]),
  confidence: z.number().int().min(0).max(100),
  evidenceIds: evidenceIdsSchema,
}).strict();

export const qualificationAssessmentEnvelopeSchema = z.object({
  assessments: z.array(qualificationAssessmentSchema).max(100),
}).strict();

const findingSchema = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,79}$/),
  status: z.enum(["verified", "inferred", "conflicting", "unknown"]),
  confidence: z.number().int().min(0).max(100),
  evidenceIds: z.array(z.string().uuid()).max(50).transform(
    (values) => [...new Set(values)].sort(),
  ),
}).strict();

const websiteAuditInputSchema = z.object({
  gateResult: websiteGateStateSchema,
  confidence: z.number().int().min(0).max(100),
  evidenceIds: z.array(z.string().uuid()).max(100).transform(
    (values) => [...new Set(values)].sort(),
  ),
}).strict();

export type QualificationAssessment = z.infer<typeof qualificationAssessmentSchema>;

export interface QualificationInput {
  gates: QualificationGate[];
  rules: QualificationRule[];
  findings: Array<z.input<typeof findingSchema>>;
  assessments: QualificationAssessment[];
  knownEvidenceIds: string[];
  websiteAudit: z.input<typeof websiteAuditInputSchema> | null;
  publishedEmailConfidence: number | null;
}

export interface GateResult {
  type: QualificationGate["type"];
  key: string;
  status: "passed" | "failed" | "needs_review";
  reason: string;
  evidenceIds: string[];
}

export interface QualificationResult {
  decision: "eligible" | "excluded" | "needs_review" | "no_email";
  commercialFit: number;
  evidenceConfidence: number;
  businessStrength: number;
  contactability: number;
  score: number;
  gates: GateResult[];
  reasons: string[];
  evidenceIds: string[];
}

const minimumCommercialScore = 60;

function signal(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : clamp(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/**
 * Formula (integer rounding occurs once per dimension): commercial fit is 50
 * plus half of the confidence-adjusted configured weight, normalized by total
 * scoring weight. Evidence confidence is the mean confidence of usable inputs;
 * business strength is the mean verified finding confidence (inference counts
 * half); final commercial score is 50% fit + 30% evidence confidence + 20%
 * business strength. Contactability remains separate from commercial merit.
 */
export function evaluateQualification(rawInput: QualificationInput): QualificationResult {
  const gates = z.array(qualificationGateSchema).max(50).parse(rawInput.gates);
  const rules = z.array(qualificationRuleSchema).max(100).parse(rawInput.rules);
  const findings = z.array(findingSchema).max(100).parse(rawInput.findings);
  const assessments = z.array(qualificationAssessmentSchema).max(100).parse(
    rawInput.assessments,
  );
  const websiteAudit = rawInput.websiteAudit === null
    ? null
    : websiteAuditInputSchema.parse(rawInput.websiteAudit);
  const publishedEmailConfidence = z.number().int().min(0).max(100).nullable().parse(
    rawInput.publishedEmailConfidence,
  );
  const knownEvidenceIds = new Set(z.array(z.string().uuid()).max(500).parse(
    rawInput.knownEvidenceIds,
  ));
  const configured = new Map(rules.map((rule) => [signal(rule.criterion), rule]));
  const seen = new Set<string>();
  const byCriterion = new Map<string, QualificationAssessment>();
  for (const assessment of assessments) {
    const key = signal(assessment.criterion);
    if (!configured.has(key)) throw new TypeError("Assessment does not reference a configured criterion");
    if (seen.has(key)) throw new TypeError("Duplicate criterion assessment");
    if (assessment.evidenceIds.some((id) => !knownEvidenceIds.has(id))) {
      throw new TypeError("Assessment must reference owned evidence");
    }
    seen.add(key);
    byCriterion.set(key, assessment);
  }
  for (const finding of findings) {
    if (finding.evidenceIds.some((id) => !knownEvidenceIds.has(id))) {
      throw new TypeError("Finding must reference owned evidence");
    }
  }
  if (websiteAudit?.evidenceIds.some((id) => !knownEvidenceIds.has(id))) {
    throw new TypeError("Website audit must reference owned evidence");
  }

  const scoringRules = rules.filter(({ effect }) => effect === "score");
  const denominator = scoringRules.reduce((sum, { weight }) => sum + Math.abs(weight), 0);
  const weighted = scoringRules.reduce((sum, rule) => {
    const assessment = byCriterion.get(signal(rule.criterion));
    if (!assessment || assessment.outcome !== "met") return sum;
    return sum + rule.weight * (assessment.confidence / 100);
  }, 0);
  const commercialFit = denominator === 0
    ? 50
    : clamp(50 + 50 * (weighted / denominator));

  const evidenceConfidence = mean([
    ...assessments
      .filter(({ outcome }) => outcome === "met" || outcome === "not_met")
      .map(({ confidence }) => confidence),
    ...findings
      .filter(({ status }) => status === "verified" || status === "inferred")
      .map(({ confidence }) => confidence),
  ]);
  const businessStrength = mean(findings.map((finding) => {
    if (finding.status === "verified") return finding.confidence;
    if (finding.status === "inferred") return finding.confidence / 2;
    return 0;
  }));
  const contactability = publishedEmailConfidence ?? 0;
  const score = clamp(
    0.5 * commercialFit + 0.3 * evidenceConfidence + 0.2 * businessStrength,
  );

  const gateResults = gates.map<GateResult>((gate, index) => {
    if (gate.type === "website") {
      if (
        !websiteAudit
        || websiteAudit.gateResult === "UNVERIFIED"
        || websiteAudit.confidence < 75
      ) {
        return {
          type: gate.type,
          key: `website:${index}`,
          status: "needs_review",
          reason: "website_gate_unverified",
          evidenceIds: websiteAudit?.evidenceIds ?? [],
        };
      }
      const passed = gate.allowed.includes(websiteAudit.gateResult);
      return {
        type: gate.type,
        key: `website:${index}`,
        status: passed ? "passed" : "failed",
        reason: passed ? "website_gate_passed" : "website_gate_disallowed",
        evidenceIds: websiteAudit.evidenceIds,
      };
    }
    const matches = findings.filter(({ key }) => key === gate.field);
    const conflict = matches.some(({ status }) => status === "conflicting")
      || new Set(matches.flatMap(({ evidenceIds }) => evidenceIds)).size
        < matches.flatMap(({ evidenceIds }) => evidenceIds).length;
    const verified = matches.filter((finding) => (
      finding.status === "verified" && finding.confidence >= gate.minimumConfidence
    ));
    const passed = !conflict && verified.length > 0;
    return {
      type: gate.type,
      key: gate.field,
      status: passed ? "passed" : "needs_review",
      reason: passed ? "required_finding_passed" : (
        conflict ? "required_finding_conflicting" : "required_finding_missing"
      ),
      evidenceIds: [...new Set(matches.flatMap(({ evidenceIds }) => evidenceIds))].sort(),
    };
  }).sort((left, right) => left.key.localeCompare(right.key));

  const explicitExclusions = rules
    .filter(({ effect }) => effect === "exclude")
    .filter((rule) => {
      const assessment = byCriterion.get(signal(rule.criterion));
      return assessment?.outcome === "met" && assessment.confidence >= 75;
    })
    .sort((left, right) => left.criterion.localeCompare(right.criterion));
  const reasons = [
    ...explicitExclusions.map(({ criterion }) => `explicit_exclusion:${criterion}`),
    ...gateResults
      .filter(({ status }) => status !== "passed")
      .map(({ reason }) => reason),
  ];

  let decision: QualificationResult["decision"];
  if (explicitExclusions.length > 0 || gateResults.some(({ status }) => status === "failed")) {
    decision = "excluded";
  } else if (gateResults.some(({ status }) => status === "needs_review")) {
    decision = "needs_review";
  } else if (score < minimumCommercialScore) {
    decision = "excluded";
    reasons.push("commercial_score_below_threshold");
  } else if (publishedEmailConfidence === null || publishedEmailConfidence < 75) {
    decision = "no_email";
    reasons.push("no_verified_published_email");
  } else {
    decision = "eligible";
    reasons.push("commercially_eligible");
  }

  const evidenceIds = [...new Set([
    ...assessments.flatMap(({ evidenceIds }) => evidenceIds),
    ...findings.flatMap(({ evidenceIds }) => evidenceIds),
    ...(websiteAudit?.evidenceIds ?? []),
  ])].sort();

  return {
    decision,
    commercialFit,
    evidenceConfidence,
    businessStrength,
    contactability,
    score,
    gates: gateResults,
    reasons,
    evidenceIds,
  };
}
