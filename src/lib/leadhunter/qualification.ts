import { z } from "zod";

import {
  qualificationGateSchema,
  qualificationRuleSchema,
  researchQuestionSchema,
  websiteGateStateSchema,
  type QualificationGate,
  type QualificationRule,
  type ResearchQuestion,
} from "./contracts";

const httpUrlSchema = z.string().trim().url().max(2_048).refine(
  (value) => /^https?:\/\//i.test(value),
  "Evidence URL must use HTTP(S)",
);

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

export const qualificationEvidenceSchema = z.object({
  id: z.string().uuid(),
  questionKey: z.string().trim().regex(/^[a-z][a-z0-9_]{1,79}$/).nullable(),
  field: z.string().trim().min(1).max(160),
  value: z.string().trim().min(1).max(2_000),
  kind: z.enum(["fact", "hypothesis"]),
  status: z.enum(["verified", "inferred", "conflicting"]),
  confidence: z.number().int().min(0).max(100),
  sourceType: z.string().trim().min(1).max(80),
  sourceUrl: httpUrlSchema.nullable(),
}).strict().superRefine((evidence, context) => {
  const coherent = evidence.status === "verified"
    ? evidence.kind === "fact"
    : evidence.kind === "hypothesis";
  if (!coherent) {
    context.addIssue({ code: "custom", path: ["kind"], message: "Evidence kind and status disagree" });
  }
});

const websiteAuditInputSchema = z.object({
  gateResult: websiteGateStateSchema,
  confidence: z.number().int().min(0).max(100),
  evidenceIds: z.array(z.string().uuid()).max(100).transform(
    (values) => [...new Set(values)].sort(),
  ),
}).strict();

export type QualificationAssessment = z.infer<typeof qualificationAssessmentSchema>;
export type QualificationEvidence = z.infer<typeof qualificationEvidenceSchema>;

export interface QualificationInput {
  gates: QualificationGate[];
  rules: QualificationRule[];
  researchQuestions: ResearchQuestion[];
  evidence: QualificationEvidence[];
  assessments: QualificationAssessment[];
  websiteAudit: z.input<typeof websiteAuditInputSchema> | null;
  publishedEmailConfidence: number | null;
}

export interface GateResult {
  type: QualificationGate["type"] | "research_required";
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

interface EffectiveAssessment extends QualificationAssessment {
  effectiveConfidence: number;
  verifiedOnly: boolean;
  evidenceConflict: boolean;
}

interface ResearchFinding {
  key: string;
  status: "verified" | "inferred" | "conflicting" | "unknown";
  confidence: number;
  rawConfidence: number;
  evidenceIds: string[];
}

const minimumCommercialScore = 60;
const minimumVerifiedConfidence = 75;
const minimumRequiredInferenceConfidence = 90;

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

function effectiveEvidenceConfidence(evidence: QualificationEvidence): number {
  if (evidence.status === "verified") return evidence.confidence;
  if (evidence.status === "inferred") return clamp(evidence.confidence * 0.5);
  return 0;
}

function researchFinding(
  question: ResearchQuestion,
  evidence: QualificationEvidence[],
): ResearchFinding {
  const rows = evidence.filter(({ questionKey }) => questionKey === question.key);
  const evidenceIds = rows.map(({ id }) => id).sort();
  if (rows.length === 0) {
    return { key: question.key, status: "unknown", confidence: 0, rawConfidence: 0, evidenceIds };
  }
  const values = new Set(rows.map(({ value }) => signal(value)));
  if (rows.some(({ status }) => status === "conflicting") || values.size > 1) {
    return { key: question.key, status: "conflicting", confidence: 0, rawConfidence: 0, evidenceIds };
  }
  const verified = rows.filter(({ status }) => status === "verified");
  if (verified.length > 0) {
    const confidence = Math.max(...verified.map(({ confidence: value }) => value));
    return { key: question.key, status: "verified", confidence, rawConfidence: confidence, evidenceIds };
  }
  const inferred = rows.filter(({ status }) => status === "inferred");
  const rawConfidence = Math.max(0, ...inferred.map(({ confidence }) => confidence));
  return {
    key: question.key,
    status: "inferred",
    confidence: clamp(rawConfidence * 0.5),
    rawConfidence,
    evidenceIds,
  };
}

function requiredFieldFinding(
  field: string,
  evidence: QualificationEvidence[],
): ResearchFinding {
  return researchFinding(
    { key: field, prompt: field, required: false },
    evidence
      .filter((row) => row.questionKey === field || row.field === field)
      .map((row) => ({ ...row, questionKey: field })),
  );
}

/**
 * Deterministic formula: each assessment confidence is the minimum of the
 * worker cap and every persisted evidence trust value. Verified facts retain
 * their persisted confidence; inferred hypotheses contribute half (rounded to
 * the nearest integer); conflicts contribute zero and force review. Commercial
 * fit is 50 plus half the normalized confidence-adjusted configured weight.
 * Evidence confidence is the rounded mean of effective assessment and research
 * confidence. Business strength is the rounded mean research confidence. The
 * final score is 50% fit + 30% evidence confidence + 20% business strength.
 */
export function evaluateQualification(rawInput: QualificationInput): QualificationResult {
  const gates = z.array(qualificationGateSchema).max(50).parse(rawInput.gates);
  const rules = z.array(qualificationRuleSchema).max(100).parse(rawInput.rules);
  const researchQuestions = z.array(researchQuestionSchema).max(100).parse(
    rawInput.researchQuestions,
  );
  const evidence = z.array(qualificationEvidenceSchema).max(500).parse(rawInput.evidence);
  const assessments = z.array(qualificationAssessmentSchema).max(100).parse(
    rawInput.assessments,
  );
  const websiteAudit = rawInput.websiteAudit === null
    ? null
    : websiteAuditInputSchema.parse(rawInput.websiteAudit);
  const publishedEmailConfidence = z.number().int().min(0).max(100).nullable().parse(
    rawInput.publishedEmailConfidence,
  );
  const evidenceById = new Map(evidence.map((row) => [row.id, row]));
  if (evidenceById.size !== evidence.length) throw new TypeError("Duplicate persisted evidence ID");

  const configured = new Map(rules.map((rule) => [signal(rule.criterion), rule]));
  const seen = new Set<string>();
  const byCriterion = new Map<string, EffectiveAssessment>();
  for (const assessment of assessments) {
    const key = signal(assessment.criterion);
    if (!configured.has(key)) throw new TypeError("Assessment does not reference a configured criterion");
    if (seen.has(key)) throw new TypeError("Duplicate criterion assessment");
    const referenced = assessment.evidenceIds.map((id) => evidenceById.get(id));
    if (referenced.some((row) => row === undefined)) {
      throw new TypeError("Assessment must reference owned evidence");
    }
    const owned = referenced as QualificationEvidence[];
    const evidenceConflict = assessment.outcome === "conflicting"
      || owned.some(({ status }) => status === "conflicting");
    const effectiveConfidence = evidenceConflict
      ? 0
      : Math.min(
          assessment.confidence,
          ...owned.map(effectiveEvidenceConfidence),
        );
    seen.add(key);
    byCriterion.set(key, {
      ...assessment,
      outcome: evidenceConflict ? "conflicting" : assessment.outcome,
      effectiveConfidence,
      verifiedOnly: owned.every(({ kind, status }) => kind === "fact" && status === "verified"),
      evidenceConflict,
    });
  }
  if (websiteAudit?.evidenceIds.some((id) => !evidenceById.has(id))) {
    throw new TypeError("Website audit must reference owned evidence");
  }

  const findings = researchQuestions
    .map((question) => researchFinding(question, evidence))
    .sort((left, right) => left.key.localeCompare(right.key));
  const scoringRules = rules.filter(({ effect }) => effect === "score");
  const denominator = scoringRules.reduce((sum, { weight }) => sum + Math.abs(weight), 0);
  const weighted = scoringRules.reduce((sum, rule) => {
    const assessment = byCriterion.get(signal(rule.criterion));
    if (!assessment || assessment.outcome !== "met") return sum;
    return sum + rule.weight * (assessment.effectiveConfidence / 100);
  }, 0);
  const commercialFit = denominator === 0
    ? 50
    : clamp(50 + 50 * (weighted / denominator));
  const evidenceConfidence = mean([
    ...[...byCriterion.values()]
      .filter(({ outcome }) => outcome === "met" || outcome === "not_met")
      .map(({ effectiveConfidence }) => effectiveConfidence),
    ...findings
      .filter(({ status }) => status === "verified" || status === "inferred")
      .map(({ confidence }) => confidence),
  ]);
  const businessStrength = mean(findings.map(({ confidence }) => confidence));
  const contactability = publishedEmailConfidence ?? 0;
  const score = clamp(
    0.5 * commercialFit + 0.3 * evidenceConfidence + 0.2 * businessStrength,
  );

  const configuredGateResults = gates.map<GateResult>((gate, index) => {
    if (gate.type === "website") {
      if (
        !websiteAudit
        || websiteAudit.gateResult === "UNVERIFIED"
        || websiteAudit.confidence < minimumVerifiedConfidence
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
    const finding = findings.find(({ key }) => key === gate.field)
      ?? requiredFieldFinding(gate.field, evidence);
    const passed = finding?.status === "verified"
      && finding.confidence >= gate.minimumConfidence;
    return {
      type: gate.type,
      key: gate.field,
      status: passed ? "passed" : "needs_review",
      reason: passed ? "required_finding_passed" : (
        finding?.status === "conflicting"
          ? "required_finding_conflicting"
          : "required_finding_missing"
      ),
      evidenceIds: finding?.evidenceIds ?? [],
    };
  });
  const researchGateResults = researchQuestions
    .filter(({ required }) => required)
    .map<GateResult>((question) => {
      const finding = findings.find(({ key }) => key === question.key)!;
      const verified = finding.status === "verified"
        && finding.confidence >= minimumVerifiedConfidence;
      const acceptedInference = finding.status === "inferred"
        && finding.rawConfidence >= minimumRequiredInferenceConfidence;
      const passed = verified || acceptedInference;
      return {
        type: "research_required",
        key: `research:${question.key}`,
        status: passed ? "passed" : "needs_review",
        reason: verified
          ? "required_research_verified"
          : acceptedInference
            ? "required_research_inferred"
            : finding.status === "conflicting"
              ? "required_research_conflicting"
              : finding.status === "inferred"
                ? "required_research_low_confidence"
                : "required_research_missing",
        evidenceIds: finding.evidenceIds,
      };
    });
  const gateResults = [...configuredGateResults, ...researchGateResults]
    .sort((left, right) => left.key.localeCompare(right.key));

  const exclusionRules = rules.filter(({ effect }) => effect === "exclude");
  const explicitExclusions = exclusionRules
    .filter((rule) => {
      const assessment = byCriterion.get(signal(rule.criterion));
      return assessment?.outcome === "met"
        && assessment.verifiedOnly
        && assessment.effectiveConfidence >= minimumVerifiedConfidence;
    })
    .sort((left, right) => left.criterion.localeCompare(right.criterion));
  const uncertainExclusions = exclusionRules
    .filter((rule) => {
      const assessment = byCriterion.get(signal(rule.criterion));
      return assessment?.outcome === "met"
        && (!assessment.verifiedOnly || assessment.effectiveConfidence < minimumVerifiedConfidence);
    })
    .sort((left, right) => left.criterion.localeCompare(right.criterion));
  const conflictingAssessments = [...byCriterion.values()]
    .filter(({ evidenceConflict }) => evidenceConflict)
    .sort((left, right) => left.criterion.localeCompare(right.criterion));
  const reasons = [
    ...explicitExclusions.map(({ criterion }) => `explicit_exclusion:${criterion}`),
    ...uncertainExclusions.map(({ criterion }) => `exclusion_not_verified:${criterion}`),
    ...conflictingAssessments.map(({ criterion }) => `assessment_evidence_conflicting:${criterion}`),
    ...gateResults.filter(({ status }) => status !== "passed").map(({ reason }) => reason),
  ];

  let decision: QualificationResult["decision"];
  if (explicitExclusions.length > 0 || gateResults.some(({ status }) => status === "failed")) {
    decision = "excluded";
  } else if (
    uncertainExclusions.length > 0
    || conflictingAssessments.length > 0
    || gateResults.some(({ status }) => status === "needs_review")
  ) {
    decision = "needs_review";
  } else if (score < minimumCommercialScore) {
    decision = "excluded";
    reasons.push("commercial_score_below_threshold");
  } else if (publishedEmailConfidence === null || publishedEmailConfidence < minimumVerifiedConfidence) {
    decision = "no_email";
    reasons.push("no_verified_published_email");
  } else {
    decision = "eligible";
    reasons.push("commercially_eligible");
  }

  const usedEvidenceIds = [...new Set([
    ...assessments.flatMap(({ evidenceIds: ids }) => ids),
    ...findings.flatMap(({ evidenceIds: ids }) => ids),
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
    evidenceIds: usedEvidenceIds,
  };
}
