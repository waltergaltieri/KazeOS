import { describe, expect, it } from "vitest";

import {
  reduceResearchDossier,
  validateResearchWorkerOutput,
  type AcceptedResearchEvidence,
  type ResearchBoundaryContext,
} from "./research";

const questions = [
  { key: "business_name", prompt: "Nombre comercial", required: true },
  { key: "business_activity", prompt: "Actividad", required: true },
  { key: "business_address", prompt: "Dirección", required: false },
];

const context: ResearchBoundaryContext = {
  ownerId: "00000000-0000-4000-8000-000000000001",
  leadId: "00000000-0000-4000-8000-000000000002",
  campaignId: "00000000-0000-4000-8000-000000000003",
  campaignVersion: 4,
  questions,
  expectedSource: {
    sourceUrl: "https://Example.com/about?b=2&a=1#team",
    sourceType: "official_site",
    suppliedAt: "2026-09-30T12:00:00.000Z",
    contentSha256: "a".repeat(64),
  },
  expectedBudget: {
    maxRuntimeMs: 2_000,
    maxModelCalls: 1,
    maxInputTokens: 2_000,
    maxOutputTokens: 1_000,
    maxCostUsd: 0.1,
  },
};

function workerOutput(findings: unknown[]) {
  return {
    source_url: context.expectedSource.sourceUrl,
    source_type: "official_site",
    supplied_at: "2026-09-30T12:00:00Z",
    content_sha256: "a".repeat(64),
    findings,
    diagnostics: [],
    usage: {
      extractor: "offline-v1",
      elapsed_ms: 12,
      model_calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      estimated_cost_usd: 0,
    },
  };
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    field: "business_name",
    value: "Acme Distribuciones",
    status: "verified",
    confidence: 92,
    source_url: context.expectedSource.sourceUrl,
    extract: "Acme Distribuciones",
    ...overrides,
  };
}

describe("LeadHunter research worker boundary", () => {
  it("accepts strict grounded-shaped findings with stable provenance IDs", () => {
    const first = validateResearchWorkerOutput(context, workerOutput([finding()]));
    const second = validateResearchWorkerOutput(context, workerOutput([finding()]));

    expect(first.fatal).toBe(false);
    expect(first.rejected).toEqual([]);
    expect(first.accepted).toHaveLength(1);
    expect(first.accepted[0]).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      questionKey: "business_name",
      sourceUrl: "https://Example.com/about?b=2&a=1#team",
      normalizedSourceUrl: "https://example.com/about?a=1&b=2",
      suppliedAt: "2026-09-30T12:00:00.000Z",
      status: "verified",
      confidence: 92,
    });
    expect(second.accepted[0]?.id).toBe(first.accepted[0]?.id);
  });

  it("rejects unknown question keys and unknown finding fields without losing valid findings", () => {
    const result = validateResearchWorkerOutput(context, workerOutput([
      finding(),
      finding({ field: "business_secret", value: "token", extract: "token" }),
      { ...finding(), action: "send_mail" },
    ]));

    expect(result.fatal).toBe(false);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected.map((item) => item.code)).toEqual([
      "unsupported_question",
      "invalid_finding",
    ]);
  });

  it("accepts an omitted optional extract as null", () => {
    const withoutExtract: Record<string, unknown> = finding();
    delete withoutExtract.extract;
    const result = validateResearchWorkerOutput(context, workerOutput([withoutExtract]));

    expect(result.rejected).toEqual([]);
    expect(result.accepted[0]?.extract).toBeNull();
  });

  it("rejects invalid root data, source substitutions and unbounded metadata", () => {
    const extraRoot = validateResearchWorkerOutput(context, {
      ...workerOutput([finding()]),
      credentials: { apiKey: "secret" },
    });
    const wrongSource = validateResearchWorkerOutput(context, workerOutput([
      finding({ source_url: "https://attacker.example/" }),
    ]));
    const wrongHash = validateResearchWorkerOutput(context, {
      ...workerOutput([finding()]),
      content_sha256: "b".repeat(64),
    });
    const credentialedSource = validateResearchWorkerOutput(context, workerOutput([
      finding({ source_url: "https://user:password@example.com/about?b=2&a=1#team" }),
    ]));

    expect(extraRoot).toMatchObject({ fatal: true, accepted: [] });
    expect(wrongSource.rejected[0]?.code).toBe("source_mismatch");
    expect(wrongHash).toMatchObject({ fatal: true, accepted: [] });
    expect(credentialedSource.rejected[0]?.code).toBe("invalid_finding");
  });

  it("rejects usage above the job budget", () => {
    const result = validateResearchWorkerOutput(context, {
      ...workerOutput([finding()]),
      usage: {
        ...workerOutput([]).usage,
        estimated_cost_usd: 0.11,
      },
    });

    expect(result).toMatchObject({
      fatal: true,
      rejected: [expect.objectContaining({ code: "budget_exceeded" })],
    });
  });

  it("rejects more than 50 findings at the worker boundary", () => {
    const result = validateResearchWorkerOutput(
      context,
      workerOutput(Array.from({ length: 51 }, () => finding())),
    );

    expect(result).toMatchObject({
      fatal: true,
      rejected: [expect.objectContaining({ code: "invalid_envelope" })],
    });
  });

  it("accepts exactly 50 findings at the worker boundary", () => {
    const result = validateResearchWorkerOutput(
      context,
      workerOutput(Array.from({ length: 50 }, () => finding())),
    );

    expect(result.fatal).toBe(false);
    expect(result.accepted).toHaveLength(50);
  });
});

function evidence(
  id: string,
  questionKey: string,
  value: string,
  status: AcceptedResearchEvidence["status"],
  confidence: number,
  extract: string | null = value,
): AcceptedResearchEvidence {
  return {
    id,
    questionKey,
    field: questionKey,
    value,
    status,
    confidence,
    sourceUrl: "https://example.com/about",
    normalizedSourceUrl: "https://example.com/about",
    sourceType: "official_site",
    suppliedAt: "2026-09-30T12:00:00.000Z",
    extract,
    contentHash: "a".repeat(64),
  };
}

describe("LeadHunter research dossier reducer", () => {
  it("combines complementary descriptive facts from different pages", () => {
    const dossier = reduceResearchDossier([{ key: "business_model", prompt: "Qué hace", required: true }], [
      evidence("1", "business_model", "Venta mayorista de alimentos", "verified", 90),
      evidence("2", "business_model", "Distribución de bebidas a comercios", "verified", 90),
    ]);
    expect(dossier.conflicts).toEqual([]);
    expect(dossier.usableFactIds).toHaveLength(2);
  });
  it("keeps unknown answers in memory without creating fake evidence", () => {
    const dossier = reduceResearchDossier(questions, [
      evidence("00000000-0000-5000-8000-000000000001", "business_name", "Acme", "verified", 90),
    ]);

    expect(dossier.answers["business_activity"]).toEqual({
      status: "unknown",
      values: [],
      evidenceIds: [],
    });
    expect(dossier.requiredUnknowns).toEqual(["business_activity"]);
    expect(Object.values(dossier.answers).flatMap((answer) => answer.evidenceIds)).toHaveLength(1);
  });

  it("keeps conflicts visible and never promotes them to usable facts", () => {
    const dossier = reduceResearchDossier(questions, [
      evidence("00000000-0000-5000-8000-000000000001", "business_name", "Acme", "verified", 95),
      evidence("00000000-0000-5000-8000-000000000002", "business_activity", "Mayorista", "verified", 90),
      evidence("00000000-0000-5000-8000-000000000003", "business_address", "Calle 1", "verified", 90),
      evidence("00000000-0000-5000-8000-000000000004", "business_address", "Calle 2", "verified", 90),
    ]);

    expect(dossier.answers["business_address"]).toMatchObject({
      status: "conflicting",
      values: ["Calle 1", "Calle 2"],
    });
    expect(dossier.conflicts).toEqual(["business_address"]);
    expect(dossier.usableFactIds).toEqual([
      "00000000-0000-5000-8000-000000000001",
      "00000000-0000-5000-8000-000000000002",
    ]);
  });

  it("requires verified status, confidence and an extract for usable facts", () => {
    const dossier = reduceResearchDossier(questions, [
      evidence("00000000-0000-5000-8000-000000000001", "business_name", "Acme", "verified", 74),
      evidence("00000000-0000-5000-8000-000000000002", "business_activity", "Mayorista", "inferred", 99),
      evidence("00000000-0000-5000-8000-000000000003", "business_address", "Calle 1", "verified", 90, null),
    ]);

    expect(dossier.usableFactIds).toEqual([]);
    expect(dossier.answers["business_name"]?.status).toBe("verified");
    expect(dossier.answers["business_activity"]?.status).toBe("inferred");
  });
});
