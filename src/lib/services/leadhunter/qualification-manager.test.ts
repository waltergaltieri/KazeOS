// @vitest-environment node

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  persistQualificationResult,
  persistWebsiteAuditResult,
  type LeadHunterQualificationDatabase,
  type LeadHunterQualificationTransaction,
} from "./qualification-manager";
import { digestLeaseToken, JobCompletionRejectedError } from "./job-manager";

const dialect = new PgDialect();
const ownerId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const enrollmentId = "00000000-0000-4000-8000-000000000004";
const leadId = "00000000-0000-4000-8000-000000000005";
const campaignId = "00000000-0000-4000-8000-000000000006";
const evidenceId = "00000000-0000-5000-8000-000000000007";
const auditId = "00000000-0000-5000-8000-000000000009";
const leaseToken = "task8-qualification-lease-token";
const now = new Date("2026-09-30T12:01:00.000Z");
const observedAt = "2026-09-30T12:00:00.000Z";

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
      questions: [{ key: "business_model", prompt: "Qué hace", required: true }],
    },
    qualification: {
      gates: [],
      rules: [{
        criterion: "Tiene procesos manuales",
        weight: 80,
        effect: "score",
        predicate: {
          field: "business_model",
          operator: "verified_exists",
          minimumConfidence: 75,
        },
      }],
    },
    message: {
      language: "es-AR", tone: "Directo", minimumSpecificFacts: 1,
      wordRange: { minimum: 10, maximum: 100 }, intro: "Presentar",
      commercialModel: "Proponer", cta: "Conversar", signature: "KazeCode",
      requiredSections: ["cta", "signature"], restrictedPhrases: [],
    },
  };
}

function lockedJob(
  kind: "audit_website" | "qualify",
  overrides: Record<string, unknown> = {},
) {
  return {
    id: jobId, runId, enrollmentId, leadId, campaignId,
    campaignVersion: 3, currentCampaignVersion: 3,
    state: "leased", kind,
    payload: kind === "audit_website" ? { leadId, website: null } : { leadId },
    result: null,
    leaseTokenDigest: digestLeaseToken(leaseToken),
    leaseExpiresAt: "2026-09-30T12:05:00.000Z",
    leaseOwner: "worker-api", evaluation: "pending",
    enrollmentStatus: "researching", leadStatus: "researching",
    snapshot: { strategy: strategy() }, researchSummary: null,
    qualificationDetail: null,
    outboundProtectionRow: {
      convertedOrClient: false, suppressed: false,
      contacted: false, activeOutbound: false,
    },
    ...overrides,
  };
}

function lockedContextResult(sql: string, row: ReturnType<typeof lockedJob>) {
  if (sql.includes('from "lh_jobs" as job')) return [row];
  if (sql.includes("pg_advisory_xact_lock")) return [];
  if (sql.includes('as "convertedOrClient"')) return [row.outboundProtectionRow];
  if (
    sql.includes('from "lh_leads" as lead')
    || sql.includes('from "lh_enrollments" as enrollment')
    || sql.includes('from "lh_campaigns" as campaign')
  ) return [row];
  return undefined;
}

function evidenceRow(id = evidenceId, overrides: Record<string, unknown> = {}) {
  return {
    id, questionKey: "business_model", field: "business_model",
    value: "Venta mayorista", kind: "fact", status: "verified",
    confidence: 90, sourceUrl: "https://example.com/about",
    sourceType: "official_site", observedAt, ...overrides,
  };
}

function input(output: unknown) {
  return { ownerId, jobId, leaseToken, now, output };
}

function noWebsiteObservations() {
  return {
    observations: [
      {
        type: "official_site", state: "absent", targetUrl: null, observedAt,
        source: { sourceType: "directory", sourceUrl: "https://directory.example/acme" },
      },
      {
        type: "active_commercial_presence", active: true, observedAt,
        source: { sourceType: "instagram", sourceUrl: "https://instagram.com/acme" },
      },
    ],
  };
}

function redirectObservationEnvelope(count: number) {
  return {
    observations: Array.from({ length: count }, (_, index) => ({
      type: "redirect",
      fromUrl: "https://example.com",
      toUrl: `https://redirect-${index}.example.net`,
      permanent: index % 2 === 0,
      observedAt,
      source: { sourceType: "http_probe", sourceUrl: "https://example.com" },
    })),
  };
}

function maximumStrategy() {
  const base = strategy();
  return {
    ...base,
    research: {
      questions: Array.from({ length: 100 }, (_, index) => ({
        key: `required_${index}`, prompt: `Required question ${index}`, required: true,
      })),
    },
    qualification: {
      gates: Array.from({ length: 50 }, () => ({
        type: "website" as const, allowed: ["NO_WEBSITE" as const],
      })),
      rules: Array.from({ length: 100 }, (_, index) => ({
        criterion: `Exclude ${index}`, weight: -1, effect: "exclude" as const,
        predicate: {
          field: `exclusion_${index}`, operator: "verified_exists" as const,
          minimumConfidence: 75,
        },
      })),
    },
  };
}

function maximumEvidenceRows() {
  return Array.from({ length: 500 }, (_, index) => evidenceRow(
    `00000000-0000-5000-8000-${(index + 1).toString().padStart(12, "0")}`,
    {
      questionKey: index < 400 ? `required_${Math.floor(index / 4)}` : null,
      field: index < 400 ? `required_${Math.floor(index / 4)}` : `exclusion_${index - 400}`,
      value: index < 400 ? `conflicting_answer_${index}` : "Verified exclusion",
      confidence: 100,
    },
  ));
}

describe("LeadHunter qualification manager", () => {
  it("locks in the global order and persists derived canonical audit evidence atomically", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const row = lockedJob("audit_website");
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      const context = lockedContextResult(rendered.sql, row);
      if (context !== undefined) return context;
      if (rendered.sql.includes('from "lh_website_audits"')) return [];
      if (rendered.sql.includes('insert into "lh_website_audits"')) return [{ id: auditId }];
      return [];
    });
    const { value, transaction } = database(execute);

    const result = await persistWebsiteAuditResult(value, input(noWebsiteObservations()));

    expect(result).toEqual({ status: "processed", auditId, gateResult: "NO_WEBSITE" });
    expect(transaction).toHaveBeenCalledOnce();
    const lockFragments = [
      'from "lh_jobs" as job', 'from "lh_leads" as lead',
      "pg_advisory_xact_lock", 'as "convertedOrClient"',
      'from "lh_enrollments" as enrollment', 'from "lh_campaigns" as campaign',
      'from "lh_website_audits"',
    ];
    const lockOrder = lockFragments.map((fragment) => (
      statements.findIndex(({ sql }) => sql.includes(fragment))
    ));
    expect(lockOrder.every((index) => index >= 0)).toBe(true);
    expect(lockOrder).toEqual([...lockOrder].sort((left, right) => left - right));
    expect(statements[0]?.sql).toContain("for update");
    expect(JSON.stringify(statements)).not.toContain(leaseToken);
    const evidenceInserts = statements.filter(({ sql }) => sql.includes('insert into "lh_evidence"'));
    expect(evidenceInserts).toHaveLength(2);
    expect(evidenceInserts.every(({ sql }) => sql.includes("on conflict (id) do nothing"))).toBe(true);
    expect(evidenceInserts.flatMap(({ params }) => params)).toEqual(expect.arrayContaining([
      ownerId, runId, campaignId, 3,
      "website_official_site", "website_active_commercial_presence",
    ]));
    const auditInsert = statements.find(({ sql }) => sql.includes('insert into "lh_website_audits"'));
    expect(auditInsert?.sql).toContain("on conflict (owner_id, run_id, enrollment_id) do nothing");
    expect(auditInsert?.params).toEqual(expect.arrayContaining([
      ownerId, runId, enrollmentId, leadId, "NO_WEBSITE",
    ]));
  });

  it("durably rejects worker-authored checks before evidence writes", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const row = lockedJob("audit_website");
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query); statements.push(rendered);
      const context = lockedContextResult(rendered.sql, row);
      if (context !== undefined) return context;
      if (rendered.sql.includes('from "lh_website_audits"')) return [];
      return [];
    });
    const { value } = database(execute);
    await expect(persistWebsiteAuditResult(value, input({ checks: [] })))
      .resolves.toMatchObject({ status: "rejected" });
    expect(statements.some(({ sql }) => sql.includes('insert into "lh_evidence"'))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes('insert into "lh_website_audits"'))).toBe(false);
    const activity = statements.find(({ sql }) => sql.includes('insert into "lh_activity"'));
    expect(JSON.parse(String(activity?.params.at(-1)))).toMatchObject({
      jobId, rejectionCode: "invalid_envelope",
    });
  });

  it("rejects a redirect not bound to the trusted target", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const row = lockedJob("audit_website", {
      payload: { leadId, website: "https://example.com" },
    });
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query); statements.push(rendered);
      const context = lockedContextResult(rendered.sql, row);
      if (context !== undefined) return context;
      if (rendered.sql.includes('from "lh_website_audits"')) return [];
      return [];
    });
    const { value } = database(execute);
    await expect(persistWebsiteAuditResult(value, input({ observations: [{
      type: "redirect", fromUrl: "https://other.example", toUrl: "https://new.example",
      permanent: true, observedAt,
      source: { sourceType: "http_probe", sourceUrl: "https://other.example" },
    }] }))).resolves.toMatchObject({ status: "rejected" });
    expect(statements.some(({ sql }) => sql.includes('insert into "lh_evidence"'))).toBe(false);
    const activity = statements.find(({ sql }) => sql.includes('insert into "lh_activity"'));
    expect(JSON.parse(String(activity?.params.at(-1)))).toMatchObject({
      rejectionCode: "invalid_observation_provenance",
    });
  });

  it.each([20, 21, 100])(
    "persists and idempotently replays all %i redirect evidence IDs",
    async (count) => {
      let completed = false;
      let storedResult: unknown = null;
      let persistedEvidenceIds: string[] = [];
      const statements: string[] = [];
      const execute = vi.fn(async (query: unknown) => {
        const rendered = queryText(query);
        statements.push(rendered.sql);
        const row = lockedJob("audit_website", {
          state: completed ? "succeeded" : "leased",
          payload: { leadId, website: "https://example.com" },
          result: storedResult,
        });
        const context = lockedContextResult(rendered.sql, row);
        if (context !== undefined) return context;
        if (rendered.sql.includes('from "lh_website_audits"')) return [];
        if (rendered.sql.includes('insert into "lh_website_audits"')) {
          const jsonArrays = rendered.params.filter((parameter): parameter is string => (
            typeof parameter === "string" && parameter.startsWith("[")
          ));
          persistedEvidenceIds = JSON.parse(jsonArrays.at(-1) ?? "[]") as string[];
          return [{ id: auditId }];
        }
        if (rendered.sql.includes('update "lh_jobs"') && rendered.sql.includes("state = 'succeeded'")) {
          storedResult = JSON.parse(String(rendered.params[0]));
          completed = true;
        }
        return [];
      });
      const { value } = database(execute);
      const output = redirectObservationEnvelope(count);

      const first = await persistWebsiteAuditResult(value, input(output));
      const retry = await persistWebsiteAuditResult(value, input(output));

      expect(first).toEqual({ status: "processed", auditId, gateResult: "UNVERIFIED" });
      expect(retry).toEqual({ ...first, status: "already_processed" });
      expect(persistedEvidenceIds).toHaveLength(count);
      expect(new Set(persistedEvidenceIds)).toHaveLength(count);
      expect(statements.filter((sql) => sql.includes('insert into "lh_evidence"')))
        .toHaveLength(count);
      expect(statements.filter((sql) => sql.includes('insert into "lh_website_audits"')))
        .toHaveLength(1);
    },
  );

  it("rejects 101 redirect observations before any audit evidence write", async () => {
    const statements: string[] = [];
    const row = lockedJob("audit_website", {
      payload: { leadId, website: "https://example.com" },
    });
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered.sql);
      const context = lockedContextResult(rendered.sql, row);
      if (context !== undefined) return context;
      if (rendered.sql.includes('from "lh_website_audits"')) return [];
      return [];
    });
    const { value } = database(execute);

    await expect(persistWebsiteAuditResult(value, input(redirectObservationEnvelope(101))))
      .resolves.toMatchObject({ status: "rejected" });
    expect(statements.some((sql) => sql.includes('insert into "lh_evidence"'))).toBe(false);
    expect(statements.some((sql) => sql.includes('insert into "lh_website_audits"'))).toBe(false);
  });

  it("recomputes qualification and keeps eligible work pre-message", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const row = lockedJob("qualify");
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query); statements.push(rendered);
      const context = lockedContextResult(rendered.sql, row);
      if (context !== undefined) return context;
      if (rendered.sql.includes('from "lh_website_audits"')) return [];
      if (rendered.sql.includes('from "lh_evidence"')) return [evidenceRow()];
      if (rendered.sql.includes('from "lh_contacts"')) return [{ emailConfidence: 90 }];
      return [];
    });
    const { value } = database(execute);
    const result = await persistQualificationResult(value, input({}));
    expect(result).toMatchObject({ status: "processed", decision: "eligible", score: 93 });
    const enrollment = statements.find(({ sql }) => sql.includes('update "lh_enrollments"'));
    expect(enrollment?.params).toEqual(expect.arrayContaining([
      "eligible", "researching", 93, ownerId, enrollmentId, leadId, campaignId, 3,
    ]));
    expect(enrollment?.params).not.toContain("ready");
    expect(statements.some(({ sql }) => (
      sql.includes('update "lh_leads"') && sql.includes("status = 'qualified'")
    ))).toBe(true);
  });

  it("re-reads outbound protection under the lock and forces stopped", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const row = lockedJob("qualify", {
      outboundProtectionRow: {
        convertedOrClient: true, suppressed: false,
        contacted: false, activeOutbound: false,
      },
    });
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query); statements.push(rendered);
      const context = lockedContextResult(rendered.sql, row);
      if (context !== undefined) return context;
      if (rendered.sql.includes('from "lh_website_audits"')) return [];
      if (rendered.sql.includes('from "lh_evidence"')) return [evidenceRow()];
      if (rendered.sql.includes('from "lh_contacts"')) return [{ emailConfidence: 90 }];
      return [];
    });
    const { value } = database(execute);
    const result = await persistQualificationResult(value, input({}));
    expect(result).toMatchObject({ status: "processed", decision: "eligible" });
    const protectionIndex = statements.findIndex(({ sql }) => sql.includes('as "convertedOrClient"'));
    const enrollmentIndex = statements.findIndex(({ sql }) => sql.includes('update "lh_enrollments"'));
    expect(enrollmentIndex).toBeGreaterThan(protectionIndex);
    expect(statements[enrollmentIndex]?.params).toEqual(expect.arrayContaining([
      "eligible", "stopped", expect.stringContaining("outbound_blocked:converted_or_client"),
    ]));
    expect(statements.some(({ sql }) => (
      sql.includes('update "lh_leads"') && sql.includes("status = 'qualified'")
    ))).toBe(false);
    const activity = statements.find(({ sql }) => sql.includes('insert into "lh_activity"'));
    expect(JSON.parse(String(activity?.params.at(-1)))).toMatchObject({
      outboundBlocked: true,
      outboundBlockReason: "converted_or_client",
      enrollmentStatus: "stopped",
    });
  });

  it("records no_email merit and stays pre-message", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const row = lockedJob("qualify");
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query); statements.push(rendered);
      const context = lockedContextResult(rendered.sql, row);
      if (context !== undefined) return context;
      if (rendered.sql.includes('from "lh_website_audits"')) return [];
      if (rendered.sql.includes('from "lh_evidence"')) return [evidenceRow()];
      if (rendered.sql.includes('from "lh_contacts"')) return [];
      return [];
    });
    const { value } = database(execute);
    const result = await persistQualificationResult(value, input({}));
    expect(result).toMatchObject({ status: "processed", decision: "no_email" });
    const enrollment = statements.find(({ sql }) => sql.includes('update "lh_enrollments"'));
    expect(enrollment?.params).toEqual(expect.arrayContaining(["no_email", "researching"]));
  });

  it("keeps legacy free-text rules in review", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const legacy = strategy();
    legacy.qualification.rules = [{
      criterion: "Tiene procesos manuales", weight: 80, effect: "score",
    }] as typeof legacy.qualification.rules;
    const row = lockedJob("qualify", { snapshot: { strategy: legacy } });
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query); statements.push(rendered);
      const context = lockedContextResult(rendered.sql, row);
      if (context !== undefined) return context;
      if (rendered.sql.includes('from "lh_website_audits"')) return [];
      if (rendered.sql.includes('from "lh_evidence"')) return [evidenceRow()];
      if (rendered.sql.includes('from "lh_contacts"')) return [{ emailConfidence: 100 }];
      return [];
    });
    const { value } = database(execute);
    const result = await persistQualificationResult(value, input({}));
    expect(result).toMatchObject({ status: "processed", decision: "needs_review" });
    expect(result.detail?.reasons).toContain("unstructured_rule:Tiene procesos manuales");
    const enrollment = statements.find(({ sql }) => sql.includes('update "lh_enrollments"'));
    expect(enrollment?.params).toEqual(expect.arrayContaining(["needs_review", "researching"]));
  });

  it("rebuilds required answers from exact-version evidence", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const row = lockedJob("qualify", {
      researchSummary: { findings: [{ key: "business_model", status: "verified", confidence: 100 }] },
    });
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query); statements.push(rendered);
      const context = lockedContextResult(rendered.sql, row);
      if (context !== undefined) return context;
      if (rendered.sql.includes('from "lh_website_audits"')) return [];
      if (rendered.sql.includes('from "lh_evidence"')) return [];
      if (rendered.sql.includes('from "lh_contacts"')) return [{ emailConfidence: 100 }];
      return [];
    });
    const { value } = database(execute);
    const result = await persistQualificationResult(value, input({}));
    expect(result).toMatchObject({ status: "processed", decision: "needs_review" });
    expect(result.detail?.gates).toContainEqual(expect.objectContaining({
      key: "research:business_model", status: "needs_review",
    }));
    const read = statements.find(({ sql }) => sql.includes('from "lh_evidence"'));
    expect(read?.sql).toContain('"lh_evidence"."run_id" = $');
    expect(read?.sql).toContain('"lh_evidence"."campaign_version" = $');
  });

  it.each([101, 500])("accepts a persisted audit with %i owned evidence IDs", async (count) => {
    const ids = Array.from(
      { length: count },
      (_, index) => `00000000-0000-5000-8003-${index.toString().padStart(12, "0")}`,
    );
    const auditStrategy = strategy();
    auditStrategy.qualification.gates = [{
      type: "website", allowed: ["GOOD_ENOUGH_WEBSITE"],
    }] as typeof auditStrategy.qualification.gates;
    const row = lockedJob("qualify", { snapshot: { strategy: auditStrategy } });
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      const context = lockedContextResult(rendered.sql, row);
      if (context !== undefined) return context;
      if (rendered.sql.includes('from "lh_website_audits"')) return [{
        id: auditId, gateResult: "GOOD_ENOUGH_WEBSITE", checks: [],
        summary: "Verified website", confidence: 100, evidenceIds: ids,
      }];
      if (rendered.sql.includes('from "lh_evidence"')) return ids.map((id) => evidenceRow(id));
      if (rendered.sql.includes('from "lh_contacts"')) return [{ emailConfidence: 100 }];
      return [];
    });
    const { value } = database(execute);
    const result = await persistQualificationResult(value, input({}));
    expect(result).toMatchObject({ status: "processed", decision: "eligible" });
    expect(result.detail?.evidenceIds).toHaveLength(count);
    expect(result.detail?.gates[0]?.evidenceIds).toHaveLength(count);
  });

  it("rejects persisted audit evidence beyond 500 before writes", async () => {
    const statements: string[] = [];
    const ids = Array.from(
      { length: 501 },
      (_, index) => `00000000-0000-5000-8004-${index.toString().padStart(12, "0")}`,
    );
    const row = lockedJob("qualify");
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query); statements.push(rendered.sql);
      const context = lockedContextResult(rendered.sql, row);
      if (context !== undefined) return context;
      if (rendered.sql.includes('from "lh_website_audits"')) return [{
        id: auditId, gateResult: "GOOD_ENOUGH_WEBSITE", checks: [],
        summary: "Oversized", confidence: 100, evidenceIds: ids,
      }];
      if (rendered.sql.includes('from "lh_evidence"')) {
        return ids.slice(0, 500).map((id) => evidenceRow(id));
      }
      if (rendered.sql.includes('from "lh_contacts"')) return [{ emailConfidence: 100 }];
      return [];
    });
    const { value } = database(execute);
    await expect(persistQualificationResult(value, input({})))
      .resolves.toMatchObject({ status: "rejected" });
    expect(statements.some((sql) => sql.includes('update "lh_enrollments"'))).toBe(false);
  });

  it("persists and replays the maximum valid detail losslessly", async () => {
    let completed = false;
    let qualificationDetail: unknown = null;
    let storedResult: unknown = null;
    const rows = maximumEvidenceRows();
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      const row = lockedJob("qualify", {
        state: completed ? "succeeded" : "leased",
        snapshot: { strategy: maximumStrategy() }, qualificationDetail, result: storedResult,
      });
      const context = lockedContextResult(rendered.sql, row);
      if (context !== undefined) return context;
      if (rendered.sql.includes('from "lh_website_audits"')) return [{
        id: auditId, gateResult: "GOOD_ENOUGH_WEBSITE", checks: [],
        summary: "Verified", confidence: 100, evidenceIds: [rows[0]!.id],
      }];
      if (rendered.sql.includes('from "lh_evidence"')) return rows;
      if (rendered.sql.includes('from "lh_contacts"')) return [{ emailConfidence: 100 }];
      if (rendered.sql.includes('update "lh_enrollments"')) {
        const value = rendered.params.find((parameter) => (
          typeof parameter === "string" && parameter.includes('"commercialFit"')
        ));
        qualificationDetail = JSON.parse(String(value));
      }
      if (rendered.sql.includes('update "lh_jobs"') && rendered.sql.includes("state = 'succeeded'")) {
        storedResult = JSON.parse(String(rendered.params[0]));
        completed = true;
      }
      return [];
    });
    const { value } = database(execute);
    const first = await persistQualificationResult(value, input({}));
    const retry = await persistQualificationResult(value, input({}));
    expect(first).toMatchObject({ status: "processed", decision: "excluded" });
    expect(first.detail?.gates).toHaveLength(150);
    expect(first.detail?.reasons).toHaveLength(250);
    expect(first.detail?.evidenceIds).toHaveLength(500);
    expect(retry).toEqual({ ...first, status: "already_processed" });
  });

  it("rejects caller decisions and assessments before writes", async () => {
    for (const output of [{ decision: "eligible", score: 100 }, { assessments: [] }]) {
      const statements: string[] = [];
      const row = lockedJob("qualify");
      const execute = vi.fn(async (query: unknown) => {
        const rendered = queryText(query); statements.push(rendered.sql);
        const context = lockedContextResult(rendered.sql, row);
        if (context !== undefined) return context;
        if (rendered.sql.includes('from "lh_website_audits"')) return [];
        return [];
      });
      const { value } = database(execute);
      await expect(persistQualificationResult(value, input(output)))
        .resolves.toMatchObject({ status: "rejected" });
      expect(statements.some((sql) => sql.includes('update "lh_enrollments"'))).toBe(false);
    }
  });

  it("rejects stale version and invalid leases before business writes", async () => {
    const staleStatements: string[] = [];
    const stale = lockedJob("qualify", { currentCampaignVersion: 4 });
    const staleExecute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query); staleStatements.push(rendered.sql);
      const context = lockedContextResult(rendered.sql, stale);
      if (context !== undefined) return context;
      if (rendered.sql.includes('from "lh_website_audits"')) return [];
      return [];
    });
    const { value: staleDatabase } = database(staleExecute);
    await expect(persistQualificationResult(staleDatabase, input({})))
      .resolves.toMatchObject({ status: "rejected" });
    expect(staleStatements.some((sql) => sql.includes('update "lh_enrollments"'))).toBe(false);

    for (const invalid of [
      null,
      lockedJob("qualify", { leaseTokenDigest: "0".repeat(64) }),
      lockedJob("qualify", { leaseExpiresAt: now }),
      lockedJob("qualify", { leaseOwner: "other-worker" }),
    ]) {
      const execute = vi.fn(async (query: unknown) => {
        const rendered = queryText(query);
        if (rendered.sql.includes('from "lh_jobs" as job')) return invalid ? [invalid] : [];
        throw new Error("unexpected business query");
      });
      const { value } = database(execute);
      await expect(persistQualificationResult(value, input({})))
        .rejects.toBeInstanceOf(JobCompletionRejectedError);
      expect(execute).toHaveBeenCalledOnce();
    }
  });

  it("replays completed jobs without duplicate writes", async () => {
    const qualification = lockedJob("qualify", {
      state: "succeeded",
      result: { kind: "qualify", output: { decision: "eligible", score: 91 } },
      qualificationDetail: {
        decision: "eligible", commercialFit: 100, evidenceConfidence: 80,
        businessStrength: 80, contactability: 90, score: 91,
        gates: [], reasons: ["commercially_eligible"], evidenceIds: [],
      },
    });
    const qualificationExecute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      const context = lockedContextResult(rendered.sql, qualification);
      if (context !== undefined) return context;
      throw new Error("unexpected write");
    });
    const { value: qualificationDatabase } = database(qualificationExecute);
    await expect(persistQualificationResult(qualificationDatabase, input({})))
      .resolves.toMatchObject({ status: "already_processed", decision: "eligible", score: 91 });
    expect(qualificationExecute).toHaveBeenCalledTimes(6);

    const audit = lockedJob("audit_website", {
      state: "succeeded",
      result: { kind: "audit_website", output: { auditId, gateResult: "NO_WEBSITE" } },
    });
    const auditExecute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      const context = lockedContextResult(rendered.sql, audit);
      if (context !== undefined) return context;
      throw new Error("unexpected write");
    });
    const { value: auditDatabase } = database(auditExecute);
    await expect(persistWebsiteAuditResult(auditDatabase, input({ observations: [] })))
      .resolves.toEqual({ status: "already_processed", auditId, gateResult: "NO_WEBSITE" });
    expect(auditExecute).toHaveBeenCalledTimes(6);
  });

  it("does not duplicate a durable rejection", async () => {
    let rejected = false;
    const statements: string[] = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query); statements.push(rendered.sql);
      const row = rejected
        ? lockedJob("qualify", {
            state: "failed", leaseTokenDigest: null,
            leaseExpiresAt: null, leaseOwner: null,
          })
        : lockedJob("qualify");
      const context = lockedContextResult(rendered.sql, row);
      if (context !== undefined) return context;
      if (rendered.sql.includes('from "lh_website_audits"')) return [];
      if (rendered.sql.includes('update "lh_jobs"') && rendered.sql.includes("state = 'failed'")) {
        rejected = true;
      }
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
  });
});
