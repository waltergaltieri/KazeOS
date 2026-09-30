import { z } from "zod";

import {
  qualificationGateSchema,
  qualificationRuleSchema,
  researchQuestionSchema,
  websiteGateStateSchema,
  type QualificationGate,
  type QualificationPredicate,
  type QualificationRule,
  type ResearchQuestion,
} from "./contracts";

// Contracts permit 50 configured gates and 100 required research questions.
// At most one evaluation reason is emitted for each of 100 configured rules,
// plus one reason for each non-passing gate. Terminal reasons are mutually
// exclusive with those branches, so the true result maxima are 150 gates and
// 250 reasons. Every referenced ID must come from the 500-row evidence input.
export const maximumQualificationGateResults = 150;
export const maximumQualificationReasons = 250;
export const maximumQualificationEvidenceIds = 500;

const httpUrlSchema = z.string().trim().url().max(2_048).refine(
  (value) => /^https?:\/\//i.test(value),
  "Evidence URL must use HTTP(S)",
);

// Qualification completion is only a trigger. All outcomes are recomputed from
// the persisted campaign predicates and evidence under the manager transaction.
export const qualificationCompletionEnvelopeSchema = z.object({}).strict();
export const qualificationAssessmentEnvelopeSchema = qualificationCompletionEnvelopeSchema;

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
  evidenceIds: z.array(z.string().uuid()).max(maximumQualificationEvidenceIds).transform(
    (values) => [...new Set(values)].sort(),
  ),
}).strict();

export type QualificationEvidence = z.infer<typeof qualificationEvidenceSchema>;

export interface QualificationInput {
  gates: QualificationGate[];
  rules: QualificationRule[];
  researchQuestions: ResearchQuestion[];
  evidence: QualificationEvidence[];
  websiteAudit: z.input<typeof websiteAuditInputSchema> | null;
  publishedEmailConfidence: number | null;
}

export const qualificationGateResultSchema = z.object({
  type: z.enum(["website", "required_finding", "research_required"]),
  key: z.string().max(200),
  status: z.enum(["passed", "failed", "needs_review"]),
  reason: z.string().max(500),
  evidenceIds: z.array(z.string().uuid()).max(maximumQualificationEvidenceIds),
}).strict();

export const qualificationResultSchema = z.object({
  decision: z.enum(["eligible", "excluded", "needs_review", "no_email"]),
  commercialFit: z.number().int().min(0).max(100),
  evidenceConfidence: z.number().int().min(0).max(100),
  businessStrength: z.number().int().min(0).max(100),
  contactability: z.number().int().min(0).max(100),
  score: z.number().int().min(0).max(100),
  gates: z.array(qualificationGateResultSchema).max(maximumQualificationGateResults),
  reasons: z.array(z.string().max(500)).max(maximumQualificationReasons),
  evidenceIds: z.array(z.string().uuid()).max(maximumQualificationEvidenceIds),
}).strict();

export type GateResult = z.infer<typeof qualificationGateResultSchema>;
export type QualificationResult = z.infer<typeof qualificationResultSchema>;

interface RuleEvaluation {
  criterion: string;
  effect: "score" | "exclude";
  weight: number;
  outcome: "met" | "not_met" | "unknown" | "conflicting";
  confidence: number;
  evidenceIds: string[];
  reason: string | null;
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

function normalizedEvidenceValue(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function evaluatePredicate(
  rule: { criterion: string; weight: number; effect: "score" | "exclude"; predicate?: QualificationPredicate },
  evidence: QualificationEvidence[],
): RuleEvaluation {
  if (!rule.predicate) {
    return {
      criterion: rule.criterion,
      effect: rule.effect,
      weight: rule.weight,
      outcome: "unknown",
      confidence: 0,
      evidenceIds: [],
      reason: `unstructured_rule:${rule.criterion}`,
    };
  }
  const candidates = evidence.filter(({ field }) => field === rule.predicate!.field);
  const evidenceIds = candidates.map(({ id }) => id).sort();
  const candidateValues = new Set(candidates.map(({ value }) => normalizedEvidenceValue(value)));
  if (
    candidates.some(({ status }) => status === "conflicting")
    || (rule.predicate.operator !== "verified_exists" && candidateValues.size > 1)
  ) {
    return {
      criterion: rule.criterion, effect: rule.effect, weight: rule.weight,
      outcome: "conflicting", confidence: 0, evidenceIds,
      reason: `rule_evidence_conflicting:${rule.criterion}`,
    };
  }
  const verified = candidates.filter((row) => (
    row.kind === "fact"
    && row.status === "verified"
    && row.confidence >= rule.predicate!.minimumConfidence
  ));
  if (verified.length === 0) {
    return {
      criterion: rule.criterion, effect: rule.effect, weight: rule.weight,
      outcome: "unknown", confidence: 0, evidenceIds,
      reason: `rule_evidence_missing:${rule.criterion}`,
    };
  }
  const confidence = Math.min(...verified.map(({ confidence: value }) => value));
  const verifiedIds = verified.map(({ id }) => id).sort();
  if (rule.predicate.operator === "verified_exists") {
    return {
      criterion: rule.criterion, effect: rule.effect, weight: rule.weight,
      outcome: "met", confidence, evidenceIds: verifiedIds, reason: null,
    };
  }
  const values = new Set(verified.map(({ value }) => normalizedEvidenceValue(value)));
  if (values.size !== 1) {
    return {
      criterion: rule.criterion, effect: rule.effect, weight: rule.weight,
      outcome: "conflicting", confidence: 0, evidenceIds: verifiedIds,
      reason: `rule_evidence_conflicting:${rule.criterion}`,
    };
  }
  const [value] = values;
  if (rule.predicate.operator === "normalized_equals") {
    return {
      criterion: rule.criterion, effect: rule.effect, weight: rule.weight,
      outcome: value === normalizedEvidenceValue(rule.predicate.expected) ? "met" : "not_met",
      confidence, evidenceIds: verifiedIds, reason: null,
    };
  }
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return {
      criterion: rule.criterion, effect: rule.effect, weight: rule.weight,
      outcome: "conflicting", confidence: 0, evidenceIds: verifiedIds,
      reason: `rule_evidence_conflicting:${rule.criterion}`,
    };
  }
  return {
    criterion: rule.criterion,
    effect: rule.effect,
    weight: rule.weight,
    outcome: numericValue >= rule.predicate.minimum && numericValue <= rule.predicate.maximum
      ? "met" : "not_met",
    confidence,
    evidenceIds: verifiedIds,
    reason: null,
  };
}

/**
 * Deterministic formula: structured rule predicates are evaluated only against
 * persisted verified facts. Free-text rules, missing facts and conflicts force
 * review. Commercial fit is 50 plus half the normalized confidence-adjusted
 * configured weight. Evidence confidence is the rounded mean of rule and research
 * confidence. Business strength is the rounded mean research confidence. The
 * final score is 50% fit + 30% evidence confidence + 20% business strength.
 */
export function evaluateQualification(rawInput: QualificationInput): QualificationResult {
  const gates = z.array(qualificationGateSchema).max(50).parse(rawInput.gates);
  const rules = z.array(qualificationRuleSchema).max(100).parse(rawInput.rules);
  const researchQuestions = z.array(researchQuestionSchema).max(100).parse(
    rawInput.researchQuestions,
  );
  const evidence = z.array(qualificationEvidenceSchema)
    .max(maximumQualificationEvidenceIds)
    .parse(rawInput.evidence);
  const websiteAudit = rawInput.websiteAudit === null
    ? null
    : websiteAuditInputSchema.parse(rawInput.websiteAudit);
  const publishedEmailConfidence = z.number().int().min(0).max(100).nullable().parse(
    rawInput.publishedEmailConfidence,
  );
  const evidenceById = new Map(evidence.map((row) => [row.id, row]));
  if (evidenceById.size !== evidence.length) throw new TypeError("Duplicate persisted evidence ID");

  if (websiteAudit?.evidenceIds.some((id) => !evidenceById.has(id))) {
    throw new TypeError("Website audit must reference owned evidence");
  }

  const findings = researchQuestions
    .map((question) => researchFinding(question, evidence))
    .sort((left, right) => left.key.localeCompare(right.key));
  const ruleEvaluations = rules
    .map((rule) => evaluatePredicate(rule, evidence))
    .sort((left, right) => left.criterion.localeCompare(right.criterion));
  const scoringRules = ruleEvaluations.filter(({ effect }) => effect === "score");
  const denominator = scoringRules.reduce((sum, { weight }) => sum + Math.abs(weight), 0);
  const weighted = scoringRules.reduce((sum, evaluation) => {
    if (evaluation.outcome !== "met") return sum;
    return sum + evaluation.weight * (evaluation.confidence / 100);
  }, 0);
  const commercialFit = denominator === 0
    ? 50
    : clamp(50 + 50 * (weighted / denominator));
  const evidenceConfidence = mean([
    ...ruleEvaluations
      .filter(({ outcome }) => outcome === "met" || outcome === "not_met")
      .map(({ confidence }) => confidence),
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

  const explicitExclusions = ruleEvaluations
    .filter(({ effect, outcome }) => effect === "exclude" && outcome === "met");
  const unresolvedRules = ruleEvaluations
    .filter(({ outcome }) => outcome === "unknown" || outcome === "conflicting");
  const reasons = [
    ...explicitExclusions.map(({ criterion }) => `explicit_exclusion:${criterion}`),
    ...unresolvedRules.flatMap(({ reason }) => reason ? [reason] : []),
    ...gateResults.filter(({ status }) => status !== "passed").map(({ reason }) => reason),
  ];

  let decision: QualificationResult["decision"];
  if (explicitExclusions.length > 0 || gateResults.some(({ status }) => status === "failed")) {
    decision = "excluded";
  } else if (
    unresolvedRules.length > 0
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
    ...ruleEvaluations.flatMap(({ evidenceIds: ids }) => ids),
    ...findings.flatMap(({ evidenceIds: ids }) => ids),
    ...(websiteAudit?.evidenceIds ?? []),
  ])].sort();

  return qualificationResultSchema.parse({
    decision,
    commercialFit,
    evidenceConfidence,
    businessStrength,
    contactability,
    score,
    gates: gateResults,
    reasons,
    evidenceIds: usedEvidenceIds,
  });
}
