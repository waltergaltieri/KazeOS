import { createHash } from "node:crypto";

import { z } from "zod";

import { researchQuestionSchema, type ResearchQuestion } from "./contracts";

const httpUrlSchema = z.string().trim().url().max(2_048).refine(
  (value) => /^https?:\/\//i.test(value),
  "URL must use HTTP(S)",
).refine((value) => {
  const url = new URL(value);
  return !url.username && !url.password;
}, "URL must not contain credentials");
const isoDateSchema = z.string().datetime({ offset: true });
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const findingStatusSchema = z.enum(["verified", "inferred", "conflicting"]);

const workerFindingSchema = z.object({
  field: z.string().trim().regex(/^[a-z][a-z0-9_.-]{0,99}$/),
  value: z.string().trim().min(1).max(2_000),
  status: findingStatusSchema,
  confidence: z.number().int().min(0).max(100),
  source_url: httpUrlSchema,
  extract: z.string().trim().min(1).max(1_000).nullable().optional().transform(
    (value) => value ?? null,
  ),
}).strict();

const workerEnvelopeSchema = z.object({
  source_url: httpUrlSchema,
  source_type: z.string().trim().min(1).max(80),
  supplied_at: isoDateSchema,
  content_sha256: sha256Schema,
  findings: z.array(z.unknown()).max(50),
  diagnostics: z.array(z.string().trim().min(1).max(200)).max(20),
  usage: z.object({
    extractor: z.string().trim().min(1).max(100),
    elapsed_ms: z.number().int().min(0).max(120_000),
    model_calls: z.number().int().min(0).max(10),
    input_tokens: z.number().int().min(0).max(200_000),
    output_tokens: z.number().int().min(0).max(20_000),
    estimated_cost_usd: z.number().min(0).max(100),
  }).strict(),
}).strict();

const expectedSourceSchema = z.object({
  sourceUrl: httpUrlSchema,
  sourceType: z.string().trim().min(1).max(80),
  suppliedAt: isoDateSchema,
  contentSha256: sha256Schema,
}).strict();
const expectedBudgetSchema = z.object({
  maxRuntimeMs: z.number().int().min(50).max(120_000),
  maxModelCalls: z.number().int().min(0).max(10),
  maxInputTokens: z.number().int().min(0).max(200_000),
  maxOutputTokens: z.number().int().min(0).max(20_000),
  maxCostUsd: z.number().min(0).max(100),
}).strict();

export interface ResearchBoundaryContext {
  ownerId: string;
  leadId: string;
  campaignId: string;
  campaignVersion: number;
  questions: ResearchQuestion[];
  expectedSource: {
    sourceUrl: string;
    sourceType: string;
    suppliedAt: string;
    contentSha256: string;
  };
  expectedBudget: z.infer<typeof expectedBudgetSchema>;
}

export interface AcceptedResearchEvidence {
  id: string;
  questionKey: string;
  field: string;
  value: string;
  status: "verified" | "inferred" | "conflicting";
  confidence: number;
  sourceUrl: string;
  normalizedSourceUrl: string;
  sourceType: string;
  suppliedAt: string;
  extract: string | null;
  contentHash: string;
}

export interface RejectedResearchFinding {
  index: number | null;
  code:
    | "invalid_envelope"
    | "invalid_finding"
    | "unsupported_question"
    | "source_mismatch"
    | "budget_exceeded";
  message: string;
}

export interface ValidatedResearchOutput {
  fatal: boolean;
  accepted: AcceptedResearchEvidence[];
  rejected: RejectedResearchFinding[];
  workerDiagnostics: string[];
  usage: z.infer<typeof workerEnvelopeSchema>["usage"] | null;
}

function normalizedUrl(input: string): string {
  const url = new URL(input);
  url.hash = "";
  url.username = "";
  url.password = "";
  url.hostname = url.hostname.toLowerCase();
  url.searchParams.sort();
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

function normalizedInstant(input: string): string {
  return new Date(input).toISOString();
}

function stableUuid(parts: unknown[]): string {
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  const bytes = digest.slice(0, 32).split("");
  bytes[12] = "5";
  bytes[16] = ((Number.parseInt(bytes[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = bytes.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function findingContentHash(input: {
  contentSha256: string;
  questionKey: string;
  value: string;
  status: string;
  confidence: number;
  extract: string | null;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function validateResearchWorkerOutput(
  rawContext: ResearchBoundaryContext,
  rawOutput: unknown,
): ValidatedResearchOutput {
  const questions = z.array(researchQuestionSchema).min(1).max(100).parse(rawContext.questions);
  const expectedSource = expectedSourceSchema.parse(rawContext.expectedSource);
  const expectedBudget = expectedBudgetSchema.parse(rawContext.expectedBudget);
  const envelope = workerEnvelopeSchema.safeParse(rawOutput);
  if (!envelope.success) {
    return {
      fatal: true,
      accepted: [],
      rejected: [{
        index: null,
        code: "invalid_envelope",
        message: "Worker output did not match the bounded research envelope",
      }],
      workerDiagnostics: [],
      usage: null,
    };
  }

  const suppliedAt = normalizedInstant(expectedSource.suppliedAt);
  if (
    normalizedUrl(envelope.data.source_url) !== normalizedUrl(expectedSource.sourceUrl)
    || envelope.data.source_type !== expectedSource.sourceType
    || normalizedInstant(envelope.data.supplied_at) !== suppliedAt
    || envelope.data.content_sha256 !== expectedSource.contentSha256
  ) {
    return {
      fatal: true,
      accepted: [],
      rejected: [{
        index: null,
        code: "source_mismatch",
        message: "Worker provenance did not match the claimed research source",
      }],
      workerDiagnostics: envelope.data.diagnostics,
      usage: envelope.data.usage,
    };
  }

  if (
    envelope.data.usage.elapsed_ms > expectedBudget.maxRuntimeMs
    || envelope.data.usage.model_calls > expectedBudget.maxModelCalls
    || envelope.data.usage.input_tokens > expectedBudget.maxInputTokens
    || envelope.data.usage.output_tokens > expectedBudget.maxOutputTokens
    || envelope.data.usage.estimated_cost_usd > expectedBudget.maxCostUsd
  ) {
    return {
      fatal: true,
      accepted: [],
      rejected: [{
        index: null,
        code: "budget_exceeded",
        message: "Worker usage exceeded the trusted research job budget",
      }],
      workerDiagnostics: envelope.data.diagnostics,
      usage: envelope.data.usage,
    };
  }

  const allowedQuestions = new Set(questions.map(({ key }) => key));
  const accepted: AcceptedResearchEvidence[] = [];
  const rejected: RejectedResearchFinding[] = [];
  envelope.data.findings.forEach((rawFinding, index) => {
    const parsed = workerFindingSchema.safeParse(rawFinding);
    if (!parsed.success) {
      rejected.push({
        index,
        code: "invalid_finding",
        message: "Finding did not match the strict research evidence contract",
      });
      return;
    }
    if (!allowedQuestions.has(parsed.data.field)) {
      rejected.push({
        index,
        code: "unsupported_question",
        message: "Finding did not correspond to a configured campaign question",
      });
      return;
    }
    if (normalizedUrl(parsed.data.source_url) !== normalizedUrl(expectedSource.sourceUrl)) {
      rejected.push({
        index,
        code: "source_mismatch",
        message: "Finding source did not match the claimed research source",
      });
      return;
    }

    const contentHash = findingContentHash({
      contentSha256: expectedSource.contentSha256,
      questionKey: parsed.data.field,
      value: parsed.data.value,
      status: parsed.data.status,
      confidence: parsed.data.confidence,
      extract: parsed.data.extract,
    });
    accepted.push({
      id: stableUuid([
        rawContext.ownerId,
        rawContext.leadId,
        rawContext.campaignId,
        rawContext.campaignVersion,
        suppliedAt,
        expectedSource.sourceUrl,
        contentHash,
      ]),
      questionKey: parsed.data.field,
      field: parsed.data.field,
      value: parsed.data.value,
      status: parsed.data.status,
      confidence: parsed.data.confidence,
      sourceUrl: expectedSource.sourceUrl,
      normalizedSourceUrl: normalizedUrl(expectedSource.sourceUrl),
      sourceType: expectedSource.sourceType,
      suppliedAt,
      extract: parsed.data.extract,
      contentHash,
    });
  });

  accepted.sort((left, right) => left.id.localeCompare(right.id));
  return {
    fatal: false,
    accepted,
    rejected,
    workerDiagnostics: envelope.data.diagnostics,
    usage: envelope.data.usage,
  };
}

export type ResearchAnswerStatus = "verified" | "inferred" | "conflicting" | "unknown";

export interface ResearchDossier {
  answers: Record<string, {
    status: ResearchAnswerStatus;
    values: string[];
    evidenceIds: string[];
  }>;
  requiredUnknowns: string[];
  usableFactIds: string[];
  conflicts: string[];
}

const minimumUsableFactConfidence = 75;

// Descriptions can contain complementary observations. Scalar facts still
// require agreement, and explicit conflicts always block.
export const descriptiveResearchFields = new Set([
  "business_model", "digital_presence", "observable_process", "service_opportunity",
  "products_services", "customer_profile", "sales_channels",
  "operational_scale",
]);

export function reduceResearchDossier(
  rawQuestions: ResearchQuestion[],
  rawEvidence: AcceptedResearchEvidence[],
): ResearchDossier {
  const questions = z.array(researchQuestionSchema).min(1).max(100).parse(rawQuestions);
  const evidence = [...rawEvidence].sort((left, right) => left.id.localeCompare(right.id));
  const answers: ResearchDossier["answers"] = {};
  const requiredUnknowns: string[] = [];
  const usableFactIds: string[] = [];
  const conflicts: string[] = [];

  for (const question of questions) {
    const matches = evidence.filter(({ questionKey }) => questionKey === question.key);
    const values = [...new Set(matches.map(({ value }) => value))].sort((a, b) => a.localeCompare(b));
    const isConflicting = matches.some(({ status }) => status === "conflicting") || (values.length > 1 && !descriptiveResearchFields.has(question.key));
    let status: ResearchAnswerStatus = "unknown";
    if (isConflicting) status = "conflicting";
    else if (matches.some((finding) => finding.status === "verified")) status = "verified";
    else if (matches.length > 0) status = "inferred";

    answers[question.key] = {
      status,
      values,
      evidenceIds: matches.map(({ id }) => id),
    };
    if (question.required && status === "unknown") requiredUnknowns.push(question.key);
    if (status === "conflicting") conflicts.push(question.key);
    if (!isConflicting) {
      usableFactIds.push(...matches
        .filter((finding) => (
          finding.status === "verified"
          && finding.confidence >= minimumUsableFactConfidence
          && finding.extract !== null
          && /^https?:\/\//i.test(finding.sourceUrl)
        ))
        .map(({ id }) => id));
    }
  }

  return { answers, requiredUnknowns, usableFactIds, conflicts };
}
