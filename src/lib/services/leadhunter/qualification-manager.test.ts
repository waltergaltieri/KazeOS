// @vitest-environment node

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  persistWebsiteAuditResult,
  persistQualificationResult,
  type LeadHunterQualificationDatabase,
  type LeadHunterQualificationTransaction,
} from "./qualification-manager";
import {
  digestLeaseToken,
  JobCompletionRejectedError,
} from "./job-manager";

const dialect = new PgDialect();
const ownerId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const enrollmentId = "00000000-0000-4000-8000-000000000004";
const leadId = "00000000-0000-4000-8000-000000000005";
const campaignId = "00000000-0000-4000-8000-000000000006";
const evidenceId = "00000000-0000-5000-8000-000000000007";
const secondEvidenceId = "00000000-0000-5000-8000-000000000008";
const auditId = "00000000-0000-5000-8000-000000000009";
const leaseToken = "task8-qualification-lease-token";
const now = new Date("2026-09-30T12:01:00.000Z");

function queryText(query: unknown) {
  return dialect.sqlToQuery(query as Parameters<PgDialect["sqlToQuery"]>[0]);
}

function database(execute: (query: unknown) => Promise<unknown>) {
  const transaction = vi.fn(async (
    operation: (database: LeadHunterQualificationTransaction) => Promise<unknown>,
  ) => operation({ execute } as LeadHunterQualificationTransaction));
  return {
    value: { transaction } as unknown as LeadHunterQualificationDatabase,
    transaction,
  };
}

function strategy() {
  return {
    version: 1,
    discovery: {
      countries: ["AR"], regions: [], industries: [], queries: ["mayoristas"],
      sources: ["web_search"], seedUrls: [],
    },
    research: {
      questions: [
        { key: "business_model", prompt: "Qué hace", required: true },
      ],
    },
    qualification: {
      gates: [],
      rules: [{ criterion: "Tiene procesos manuales", weight: 80, effect: "score" }],
    },
    message: {
      language: "es-AR",
      tone: "Directo",
      minimumSpecificFacts: 1,
      wordRange: { minimum: 10, maximum: 100 },
      intro: "Presentar",
      commercialModel: "Proponer",
      cta: "Conversar",
      signature: "KazeCode",
      requiredSections: ["cta", "signature"],
      restrictedPhrases: [],
    },
  };
}

function lockedJob(
  kind: "audit_website" | "qualify",
  overrides: Record<string, unknown> = {},
) {
  return {
    id: jobId,
    runId,
    enrollmentId,
    leadId,
    campaignId,
    campaignVersion: 3,
    currentCampaignVersion: 3,
    state: "leased",
    kind,
    payload: { leadId },
    result: null,
    leaseTokenDigest: digestLeaseToken(leaseToken),
    leaseExpiresAt: "2026-09-30T12:05:00.000Z",
    leaseOwner: "worker-api",
    evaluation: "pending",
    enrollmentStatus: "researching",
    leadStatus: "researching",
    snapshot: { strategy: strategy() },
    researchSummary: null,
    auditId: null,
    auditGateResult: null,
    auditConfidence: null,
    auditEvidenceIds: null,
    auditChecks: null,
    auditSummary: null,
    qualificationDetail: null,
    ...overrides,
  };
}

function lockedContextResult(sql: string, row: ReturnType<typeof lockedJob>) {
  if (
    sql.includes('from "lh_jobs" as job')
    || sql.includes('from "lh_enrollments" as enrollment')
    || sql.includes('from "lh_leads" as lead')
    || sql.includes('from "lh_campaigns" as campaign')
  ) return [row];
  return undefined;
}

function evidenceRow(id = evidenceId, overrides: Record<string, unknown> = {}) {
  return {
    id,
    questionKey: "business_model",
    field: "business_model",
    value: "Venta mayorista",
    status: "verified",
    confidence: 90,
    sourceUrl: "https://example.com/about",
    sourceType: "official_site",
    observedAt: "2026-09-30T12:00:00.000Z",
    ...overrides,
  };
}

function auditCheck(key: string, outcome: "pass" | "fail", id: string) {
  return {
    key,
    category: key === "active_commercial_presence" ? "presence" : "presence",
    outcome,
    severity: "material",
    confidence: 90,
    observedAt: "2026-09-30T12:00:00.000Z",
    evidenceIds: [id],
    source: {
      sourceType: "official_site",
      sourceUrl: "https://example.com/about",
    },
  };
}

function input(output: unknown) {
  return { ownerId, jobId, leaseToken, now, output };
}

describe("LeadHunter qualification manager", () => {
  it("locks trusted audit state, validates evidence ownership and persists one audit atomically", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      const context = lockedContextResult(rendered.sql, lockedJob("audit_website"));
      if (context) return context;
      if (rendered.sql.includes('from "lh_evidence"')) {
        return [
          evidenceRow(),
          evidenceRow(secondEvidenceId, { field: "active_commercial_presence" }),
        ];
      }
      if (rendered.sql.includes('insert into "lh_website_audits"')) return [{ id: auditId }];
      return [];
    });
    const { value, transaction } = database(execute);

    const result = await persistWebsiteAuditResult(value, input({ checks: [
      auditCheck("official_site", "fail", evidenceId),
      auditCheck("active_commercial_presence", "pass", secondEvidenceId),
    ] }));

    expect(result).toMatchObject({
      status: "processed",
      auditId,
      gateResult: "NO_WEBSITE",
    });
    expect(transaction).toHaveBeenCalledOnce();
    const lockOrder = [
      'from "lh_jobs" as job',
      'from "lh_enrollments" as enrollment',
      'from "lh_leads" as lead',
      'from "lh_campaigns" as campaign',
      'from "lh_website_audits"',
    ].map((fragment) => statements.findIndex(({ sql }) => sql.includes(fragment)));
    expect(lockOrder).toEqual([...lockOrder].sort((left, right) => left - right));
    expect(lockOrder.every((index) => index >= 0)).toBe(true);
    expect(statements[lockOrder[0]!]!.sql).toContain('job.owner_id = $');
    expect(statements[lockOrder[0]!]!.sql).toContain("for update");
    expect(statements[lockOrder[3]!]!.sql).toContain('campaign.config_version as "currentCampaignVersion"');
    expect(JSON.stringify(statements)).not.toContain(leaseToken);
    const insert = statements.find(({ sql }) => sql.includes('insert into "lh_website_audits"'));
    expect(insert?.sql).toContain("on conflict (owner_id, run_id, enrollment_id) do nothing");
    expect(insert?.params).toEqual(expect.arrayContaining([
      expect.any(String), ownerId, runId, enrollmentId, leadId, "NO_WEBSITE",
    ]));
    expect(statements.filter(({ sql }) => sql.includes('insert into "lh_activity"'))).toHaveLength(1);
    expect(statements.find(({ sql }) => sql.includes('update "lh_jobs"'))?.sql)
      .toContain("state = 'succeeded'");
    expect(statements.some(({ sql }) => (
      sql.includes('update "lh_runs" as run') && sql.includes("summary.active_count = 0")
    ))).toBe(true);
  });

  it("durably rejects malformed or unowned audit evidence without persisting an audit", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      const context = lockedContextResult(rendered.sql, lockedJob("audit_website"));
      if (context) return context;
      if (rendered.sql.includes('from "lh_evidence"')) return [];
      return [];
    });
    const { value } = database(execute);

    await expect(persistWebsiteAuditResult(value, input({ checks: [
      auditCheck("official_site", "fail", evidenceId),
    ] }))).resolves.toMatchObject({ status: "rejected" });

    expect(statements.some(({ sql }) => sql.includes('insert into "lh_website_audits"')))
      .toBe(false);
    const jobUpdate = statements.find(({ sql }) => sql.includes('update "lh_jobs"'));
    expect(jobUpdate?.sql).toContain("state = 'failed'");
    expect(jobUpdate?.sql).toContain("lease_token_digest = null");
    expect(jobUpdate?.params).toContain("audit_website_output_rejected");
    const activity = statements.find(({ sql }) => sql.includes('insert into "lh_activity"'));
    expect(JSON.parse(String(activity?.params.at(-1)))).toMatchObject({
      jobId,
      rejectionCode: "unowned_evidence",
    });
  });

  it("recomputes qualification from the persisted strategy, evidence, audit and contact", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      const context = lockedContextResult(rendered.sql, lockedJob("qualify"));
      if (context) return context;
      if (rendered.sql.includes('from "lh_evidence"')) return [evidenceRow()];
      if (rendered.sql.includes('from "lh_contacts"')) return [{ emailConfidence: 90 }];
      return [];
    });
    const { value } = database(execute);

    const result = await persistQualificationResult(value, input({
      assessments: [{
        criterion: "Tiene procesos manuales",
        outcome: "met",
        confidence: 90,
        evidenceIds: [evidenceId],
      }],
    }));

    expect(result).toMatchObject({
      status: "processed",
      decision: "eligible",
      score: 93,
    });
    const enrollment = statements.find(({ sql }) => sql.includes('update "lh_enrollments"'));
    expect(enrollment?.sql).toContain("evaluation = $");
    expect(enrollment?.sql).toContain("status = $");
    expect(enrollment?.params).toEqual(expect.arrayContaining([
      "eligible", "ready", 93, ownerId, enrollmentId, leadId, campaignId, 3,
    ]));
    const detail = JSON.parse(String(enrollment?.params.find((value) => (
      typeof value === "string" && value.includes('"commercialFit"')
    ))));
    expect(detail).toMatchObject({ decision: "eligible", score: 93 });
    const jobUpdate = statements.find(({ sql }) => sql.includes('update "lh_jobs"'));
    const stored = JSON.parse(String(jobUpdate?.params[0]));
    expect(stored).toEqual({ kind: "qualify", output: { decision: "eligible", score: 93 } });
  });

  it("records commercial merit without inventing an email", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      const context = lockedContextResult(rendered.sql, lockedJob("qualify"));
      if (context) return context;
      if (rendered.sql.includes('from "lh_evidence"')) return [evidenceRow()];
      if (rendered.sql.includes('from "lh_contacts"')) return [];
      return [];
    });
    const { value } = database(execute);

    const result = await persistQualificationResult(value, input({
      assessments: [{
        criterion: "Tiene procesos manuales",
        outcome: "met",
        confidence: 90,
        evidenceIds: [evidenceId],
      }],
    }));

    expect(result).toMatchObject({ status: "processed", decision: "no_email" });
    expect(statements.some(({ sql }) => (
      sql.includes('update "lh_leads"') && sql.includes("status = 'qualified'")
    ))).toBe(true);
  });

  it("rejects a stale campaign version before applying a valid assessment", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      const context = lockedContextResult(
        rendered.sql,
        lockedJob("qualify", { currentCampaignVersion: 4 }),
      );
      if (context) return context;
      return [];
    });
    const { value } = database(execute);

    const result = await persistQualificationResult(value, input({
      assessments: [{
        criterion: "Tiene procesos manuales",
        outcome: "met",
        confidence: 90,
        evidenceIds: [evidenceId],
      }],
    }));

    expect(result.status).toBe("rejected");
    expect(statements.some(({ sql }) => sql.includes('update "lh_enrollments"'))).toBe(false);
    expect(statements.find(({ sql }) => sql.includes('update "lh_jobs"'))?.sql)
      .toContain("state = 'failed'");
  });

  it("rejects wrong tenant, token, expiry and lease owner before any write", async () => {
    const variants = [
      { row: null, suppliedOwner: "00000000-0000-4000-8000-000000000099" },
      { row: lockedJob("qualify", { leaseTokenDigest: "0".repeat(64) }) },
      { row: lockedJob("qualify", { leaseExpiresAt: now }) },
      { row: lockedJob("qualify", { leaseOwner: "other-worker" }) },
    ];
    for (const variant of variants) {
      const execute = vi.fn(async (query: unknown) => {
        const rendered = queryText(query);
        const context = variant.row
          ? lockedContextResult(rendered.sql, variant.row)
          : rendered.sql.includes('from "lh_jobs" as job') ? [] : undefined;
        if (context) return context;
        throw new Error("unexpected write");
      });
      const { value } = database(execute);
      await expect(persistQualificationResult(value, {
        ...input({ assessments: [] }),
        ownerId: variant.suppliedOwner ?? ownerId,
      })).rejects.toBeInstanceOf(JobCompletionRejectedError);
      expect(execute).toHaveBeenCalledOnce();
    }
  });

  it("returns an already completed decision without duplicating activity", async () => {
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      const context = lockedContextResult(rendered.sql, lockedJob("qualify", {
          state: "succeeded",
          result: { kind: "qualify", output: { decision: "eligible", score: 91 } },
          qualificationDetail: {
            decision: "eligible",
            commercialFit: 100,
            evidenceConfidence: 80,
            businessStrength: 80,
            contactability: 90,
            score: 91,
            gates: [], reasons: ["commercially_eligible"], evidenceIds: [],
          },
        }));
      if (context) return context;
      throw new Error("unexpected write");
    });
    const { value } = database(execute);

    await expect(persistQualificationResult(value, input({ assessments: [] })))
      .resolves.toMatchObject({ status: "already_processed", decision: "eligible", score: 91 });
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("returns an already completed website audit without duplicating audit or activity", async () => {
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      const context = lockedContextResult(rendered.sql, lockedJob("audit_website", {
        state: "succeeded",
        result: {
          kind: "audit_website",
          output: { auditId, gateResult: "NO_WEBSITE" },
        },
      }));
      if (context) return context;
      throw new Error("unexpected write");
    });
    const { value } = database(execute);

    await expect(persistWebsiteAuditResult(value, input({ checks: [] })))
      .resolves.toEqual({
        status: "already_processed",
        auditId,
        gateResult: "NO_WEBSITE",
      });
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("does not duplicate a durable qualification rejection", async () => {
    let rejected = false;
    const statements: string[] = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered.sql);
      const row = rejected
        ? lockedJob("qualify", {
            state: "failed",
            leaseTokenDigest: null,
            leaseExpiresAt: null,
            leaseOwner: null,
          })
        : lockedJob("qualify");
      const context = lockedContextResult(rendered.sql, row);
      if (context) return context;
      if (
        rendered.sql.includes('update "lh_jobs"')
        && rendered.sql.includes("state = 'failed'")
      ) rejected = true;
      return [];
    });
    const { value } = database(execute);
    const invalid = { decision: "eligible", score: 100 };

    await expect(persistQualificationResult(value, input(invalid)))
      .resolves.toMatchObject({ status: "rejected" });
    await expect(persistQualificationResult(value, input(invalid)))
      .rejects.toBeInstanceOf(JobCompletionRejectedError);

    expect(statements.filter((sql) => sql.includes('insert into "lh_activity"')))
      .toHaveLength(1);
    expect(statements.filter((sql) => (
      sql.includes('update "lh_jobs"') && sql.includes("state = 'failed'")
    ))).toHaveLength(1);
  });
});
