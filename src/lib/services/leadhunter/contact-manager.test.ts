// @vitest-environment node

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  persistContactEnrichmentResult,
  type LeadHunterContactDatabase,
  type LeadHunterContactTransaction,
} from "./contact-manager";
import { digestLeaseToken, JobCompletionRejectedError } from "./job-manager";

const dialect = new PgDialect();
const ownerId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const enrollmentId = "00000000-0000-4000-8000-000000000004";
const leadId = "00000000-0000-4000-8000-000000000005";
const campaignId = "00000000-0000-4000-8000-000000000006";
const contactId = "00000000-0000-5000-8000-000000000007";
const candidateId = "00000000-0000-4000-8000-000000000008";
const leaseToken = "task9-contact-enrichment-lease-token";
const suppliedAt = "2026-09-30T12:00:00.000Z";
const now = new Date("2026-09-30T12:01:00.000Z");
const source = {
  ref: "official-contact",
  sourceUrl: "https://example.com/contact",
  sourceType: "official_site",
  contentSha256: "a".repeat(64),
  suppliedAt,
};

function queryText(query: unknown) {
  return dialect.sqlToQuery(query as Parameters<PgDialect["sqlToQuery"]>[0]);
}

function database(execute: (query: unknown) => Promise<unknown>) {
  const transaction = vi.fn(async (
    operation: (transaction: LeadHunterContactTransaction) => Promise<unknown>,
  ) => operation({ execute } as LeadHunterContactTransaction));
  return {
    value: { transaction } as unknown as LeadHunterContactDatabase,
    transaction,
  };
}

function lockedJob(overrides: Record<string, unknown> = {}) {
  return {
    id: jobId,
    ownerId,
    runId,
    enrollmentId,
    leadId,
    state: "leased",
    kind: "enrich_contact",
    payload: { leadId, sources: [source] },
    result: null,
    leaseTokenDigest: digestLeaseToken(leaseToken),
    leaseExpiresAt: "2026-09-30T12:05:00.000Z",
    leaseOwner: "worker-api",
    ...overrides,
  };
}

function workerOutput(overrides: Record<string, unknown> = {}) {
  return {
    observations: [{
      sourceRef: source.ref,
      sourceUrl: source.sourceUrl,
      observedAt: suppliedAt,
      contentSha256: source.contentSha256,
      extract: "Owner Ana Pérez: Ana@Example.com",
      email: "Ana@Example.com",
      firstName: "Ana",
      lastName: "Pérez",
      role: "Owner",
    }],
    ...overrides,
  };
}

function managerInput(output: unknown) {
  return { ownerId, jobId, leaseToken, now, output };
}

function standardExecute(
  statements: Array<{ sql: string; params: unknown[] }>,
  options: {
    job?: ReturnType<typeof lockedJob>;
    protection?: Record<string, boolean>;
    contacts?: Array<Record<string, unknown>>;
  } = {},
) {
  return vi.fn(async (query: unknown) => {
    const rendered = queryText(query);
    statements.push(rendered);
    if (rendered.sql.includes('from "lh_jobs" as job')) {
      return [options.job ?? lockedJob()];
    }
    if (rendered.sql.includes('from "lh_leads" as lead')) {
      return [{ status: "researching", domain: "example.com", website: "https://example.com" }];
    }
    if (rendered.sql.includes('as "convertedOrClient"')) {
      return [options.protection ?? {
        convertedOrClient: false,
        suppressed: false,
        contacted: false,
        activeOutbound: false,
      }];
    }
    if (rendered.sql.includes('from "lh_enrollments" as enrollment')) {
      return [{
        campaignId, campaignVersion: 3, evaluation: "no_email",
        enrollmentStatus: "researching",
      }];
    }
    if (rendered.sql.includes('from "lh_campaigns" as campaign')) {
      return [{ currentCampaignVersion: 3 }];
    }
    if (rendered.sql.includes('from "lh_source_candidates"')) return [];
    if (rendered.sql.includes('from "lh_contacts"')) return options.contacts ?? [];
    if (rendered.sql.includes('insert into "lh_contacts"')) return [{ id: contactId }];
    return [];
  });
}

describe("LeadHunter contact manager", () => {
  it("persists exact publication provenance and one selected primary atomically", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = standardExecute(statements);
    const { value, transaction } = database(execute);

    const result = await persistContactEnrichmentResult(value, managerInput(workerOutput()));

    expect(result).toMatchObject({
      status: "processed",
      outcome: "selected",
      primaryContactId: contactId,
      contactIds: [contactId],
    });
    expect(transaction).toHaveBeenCalledOnce();
    const sql = statements.map(({ sql }) => sql);
    expect(sql.findIndex((value) => value.includes('from "lh_jobs" as job')))
      .toBeLessThan(sql.findIndex((value) => value.includes('from "lh_leads" as lead')));
    expect(sql.findIndex((value) => value.includes("pg_advisory_xact_lock")))
      .toBeLessThan(sql.findIndex((value) => value.includes('from "lh_enrollments" as enrollment')));
    expect(sql.findIndex((value) => value.includes('from "lh_source_candidates"')))
      .toBeLessThan(sql.findIndex((value) => value.includes('from "lh_contacts"')));

    const insert = statements.find(({ sql }) => sql.includes('insert into "lh_contacts"'));
    expect(insert?.sql).toContain("on conflict (owner_id, normalized_email)");
    expect(insert?.sql).toContain("do nothing");
    expect(insert?.params).toEqual(expect.arrayContaining([
      "Ana@Example.com", "ana@example.com", source.sourceUrl,
      source.sourceType, 100, suppliedAt,
    ]));
    const primary = statements.find(({ sql }) => sql.includes("is_primary = case"));
    expect(primary?.params).toEqual(expect.arrayContaining([ownerId, leadId, contactId]));
    const enrollment = statements.find(({ sql }) => (
      sql.includes('update "lh_enrollments"')
    ));
    expect(enrollment?.sql).toContain("evaluation = case");
    expect(enrollment?.sql).not.toContain("'ready'");
    expect(statements.some(({ sql }) => sql.includes('insert into "lh_outbox"'))).toBe(false);

    const activity = statements.find(({ sql }) => sql.includes('insert into "lh_activity"'));
    expect(JSON.stringify(activity)).not.toContain("Owner Ana Pérez");
    const completion = statements.find(({ sql }) => (
      sql.includes('update "lh_jobs"') && sql.includes("state = 'succeeded'")
    ));
    expect(completion?.sql).not.toContain("lease_token_digest = null");
    expect(completion?.sql).toContain("lease_owner = null");
    expect(completion?.sql).toContain("lease_expires_at = null");
  });

  it("durably rejects malformed valid-lease output without raw page content", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = standardExecute(statements);
    const { value } = database(execute);

    const result = await persistContactEnrichmentResult(value, managerInput({
      observations: [{ ...workerOutput().observations[0], confidence: 100 }],
    }));

    expect(result).toMatchObject({ status: "rejected", outcome: null });
    const failed = statements.find(({ sql }) => (
      sql.includes('update "lh_jobs"') && sql.includes("state = 'failed'")
    ));
    expect(failed?.sql).toContain("lease_token_digest = null");
    expect(JSON.stringify(statements)).not.toContain("Owner Ana Pérez");
  });

  it("keeps a cross-lead email in review and never changes primary ownership", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = standardExecute(statements, {
      contacts: [{
        id: "00000000-0000-5000-8000-000000000099",
        leadId: "00000000-0000-4000-8000-000000000099",
        normalizedEmail: "ana@example.com",
        isPrimary: true,
      }],
    });
    const { value } = database(execute);

    const result = await persistContactEnrichmentResult(value, managerInput(workerOutput()));

    expect(result).toMatchObject({
      status: "processed",
      outcome: "needs_review",
      primaryContactId: null,
      contactIds: [],
    });
    expect(statements.some(({ sql }) => sql.includes("is_primary = case"))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes('insert into "lh_contacts"'))).toBe(false);
  });

  it("preserves protected enrollment and lead state while allowing enrichment", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = standardExecute(statements, {
      protection: {
        convertedOrClient: false,
        suppressed: false,
        contacted: true,
        activeOutbound: false,
      },
    });
    const { value } = database(execute);

    const result = await persistContactEnrichmentResult(value, managerInput(workerOutput()));

    expect(result).toMatchObject({ outcome: "selected", outboundBlocked: true });
    expect(statements.some(({ sql }) => sql.includes('update "lh_enrollments"'))).toBe(false);
    expect(statements.some(({ sql }) => sql.includes('update "lh_leads"'))).toBe(false);
  });

  it("keeps an otherwise eligible lead visible as no_email and cannot queue mail", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = standardExecute(statements);
    const { value } = database(execute);

    const result = await persistContactEnrichmentResult(value, managerInput({ observations: [] }));

    expect(result).toMatchObject({ outcome: "no_email", primaryContactId: null });
    const enrollment = statements.find(({ sql }) => sql.includes('update "lh_enrollments"'));
    expect(enrollment?.params).toContain("no_email");
    expect(enrollment?.sql).toContain("status = 'researching'");
    expect(statements.some(({ sql }) => sql.includes('insert into "lh_outbox"'))).toBe(false);
  });

  it("rejects a wrong or expired lease before business-state writes", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = standardExecute(statements, {
      job: lockedJob({ leaseTokenDigest: digestLeaseToken("different-token") }),
    });
    const { value } = database(execute);

    await expect(persistContactEnrichmentResult(
      value,
      managerInput(workerOutput()),
    )).rejects.toBeInstanceOf(JobCompletionRejectedError);

    expect(statements).toHaveLength(1);
  });

  it("returns stored completion idempotently without replacing provenance", async () => {
    const stored = {
      kind: "enrich_contact",
      output: {
        outcome: "selected",
        contactIds: [contactId],
        primaryContactId: contactId,
        outboundBlocked: false,
      },
    };
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = standardExecute(statements, {
      job: lockedJob({ state: "succeeded", result: stored, leaseExpiresAt: null }),
    });
    const { value } = database(execute);

    await expect(persistContactEnrichmentResult(value, managerInput({ send: true })))
      .resolves.toMatchObject({ status: "already_processed", outcome: "selected" });
    expect(statements).toHaveLength(1);
  });

  it("audits a duplicate job as reused without overwriting publication provenance", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = standardExecute(statements, {
      contacts: [{
        id: contactId,
        leadId,
        email: "Ana@Example.com",
        normalizedEmail: "ana@example.com",
        firstName: "Ana",
        lastName: "Pérez",
        role: "Owner",
        sourceUrl: source.sourceUrl,
        sourceType: source.sourceType,
        emailConfidence: 100,
        verifiedAt: suppliedAt,
        isPrimary: true,
      }],
    });
    const { value } = database(execute);

    await expect(persistContactEnrichmentResult(value, managerInput(workerOutput())))
      .resolves.toMatchObject({ outcome: "selected", contactIds: [contactId] });

    expect(statements.some(({ sql }) => sql.includes('insert into "lh_contacts"'))).toBe(false);
    const activity = statements.find(({ sql }) => sql.includes('insert into "lh_activity"'));
    expect(activity?.params).toContain("contact_enrichment.reused");
  });

  it("requires a resolved owner/run/lead candidate before directory authority is medium", async () => {
    const directorySource = {
      ...source,
      ref: "directory",
      sourceUrl: "https://directory.example/acme",
      sourceType: "directory",
      sourceCandidateId: candidateId,
    };
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      if (rendered.sql.includes('from "lh_jobs" as job')) {
        return [lockedJob({ payload: { leadId, sources: [directorySource] } })];
      }
      if (rendered.sql.includes('from "lh_leads" as lead')) {
        return [{ status: "researching", domain: "acme.com", website: "https://acme.com" }];
      }
      if (rendered.sql.includes('as "convertedOrClient"')) return [{ convertedOrClient: false, suppressed: false, contacted: false, activeOutbound: false }];
      if (rendered.sql.includes('from "lh_enrollments" as enrollment')) return [{ campaignId, campaignVersion: 3, evaluation: "no_email", enrollmentStatus: "researching" }];
      if (rendered.sql.includes('from "lh_campaigns" as campaign')) return [{ currentCampaignVersion: 3 }];
      if (rendered.sql.includes('from "lh_source_candidates"')) return [{
        id: candidateId, sourceType: "directory", canonicalUrl: directorySource.sourceUrl,
        resolutionState: "resolved", leadId,
      }];
      if (rendered.sql.includes('from "lh_contacts"')) return [];
      if (rendered.sql.includes('insert into "lh_contacts"')) return [{ id: contactId }];
      return [];
    });
    const { value } = database(execute);
    const output = workerOutput({ observations: [{
      sourceRef: directorySource.ref,
      sourceUrl: directorySource.sourceUrl,
      observedAt: directorySource.suppliedAt,
      contentSha256: directorySource.contentSha256,
      extract: "hello@acme.com",
      email: "hello@acme.com",
    }] });

    const result = await persistContactEnrichmentResult(value, managerInput(output));

    expect(result.outcome).toBe("selected");
    const insert = statements.find(({ sql }) => sql.includes('insert into "lh_contacts"'));
    expect(insert?.params).toContain(75);
    const candidateLock = statements.find(({ sql }) => sql.includes('from "lh_source_candidates"'));
    expect(candidateLock?.sql).toContain("candidate.owner_id = $");
    expect(candidateLock?.sql).toContain("candidate.run_id = $");
    expect(candidateLock?.sql).toContain("candidate.lead_id = $");
  });

  it.each([false, true])("rechecks an existing official email without confusing a new date with a conflict (person conflict: %s)", async (personConflict) => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = standardExecute(statements, { contacts: [{
      id: contactId, leadId, email: "ana@example.com", normalizedEmail: "ana@example.com",
      firstName: personConflict ? "Otra persona" : "Ana", lastName: "Pérez", role: "Owner",
      sourceUrl: "https://example.com/", sourceType: "web_search", emailConfidence: 100,
      verifiedAt: "2026-09-29T12:00:00.000Z", isPrimary: true,
    }] });
    const { value } = database(execute);
    const result = await persistContactEnrichmentResult(value, managerInput(workerOutput()));
    expect(result.outcome).toBe(personConflict ? "needs_review" : "selected");
    expect(statements.some(({ sql }) => sql.includes('insert into "lh_contacts"'))).toBe(false);
    expect(statements.some(({ sql }) => /set\s+source_url/.test(sql))).toBe(false);
  });
});
