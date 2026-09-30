// @vitest-environment node

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { BusinessIdentity } from "@/lib/leadhunter/identity";

import {
  resolveSourceCandidateIdentity,
  type LeadHunterIdentityDatabase,
  type LeadHunterIdentityTransaction,
} from "./identity-manager";

const dialect = new PgDialect();
const ownerId = "00000000-0000-4000-8000-000000000001";
const candidateId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const campaignId = "00000000-0000-4000-8000-000000000004";
const existingLeadId = "00000000-0000-4000-8000-000000000005";
const newLeadId = "00000000-0000-4000-8000-000000000006";

const observation: BusinessIdentity = {
  name: "Acme Distribuciones",
  emails: ["ventas@acme.com.ar"],
  urls: [{ url: "https://ventas.acme.com.ar", role: "official_website" }],
  location: { countryCode: "AR", city: "Rosario" },
  organizationRole: "independent",
};

function queryText(query: unknown) {
  return dialect.sqlToQuery(query as Parameters<PgDialect["sqlToQuery"]>[0]);
}

function pendingCandidate() {
  return {
    id: candidateId,
    runId,
    resolutionState: "pending",
    leadId: null,
    campaignId,
    campaignVersion: 3,
    rawRecord: { observedName: "Acme Distribuciones" },
    canonicalUrl: "https://acme.com.ar",
  };
}

function existingLead(overrides: Record<string, unknown> = {}) {
  return {
    id: existingLeadId,
    name: "Acme Distribuciones SA",
    normalizedName: "acme distribuciones sa",
    domain: "acme.com.ar",
    website: "https://www.acme.com.ar",
    countryCode: "AR",
    city: "Rosario",
    emails: ["ventas@acme.com.ar"],
    address: null,
    organizationRole: "unknown",
    parentName: null,
    ...overrides,
  };
}

function transactionalDatabase(execute: (query: unknown) => Promise<unknown>) {
  const transaction = vi.fn(async (
    operation: (database: LeadHunterIdentityTransaction) => Promise<unknown>,
  ) => operation({ execute } as unknown as LeadHunterIdentityTransaction));
  return {
    database: { transaction } as unknown as LeadHunterIdentityDatabase,
    transaction,
  };
}

describe("resolveSourceCandidateIdentity", () => {
  it("links one strong owner-scoped match and records an auditable decision", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      if (rendered.sql.includes('from "lh_source_candidates"')) {
        return [pendingCandidate()];
      }
      if (rendered.sql.includes("pg_advisory_xact_lock")) return [];
      if (rendered.sql.includes('from "lh_leads"')) return [existingLead()];
      if (rendered.sql.includes("as contacted")) {
        return [{ contacted: false, activeOutbound: false }];
      }
      if (rendered.sql.includes('update "lh_source_candidates"')) {
        return [{ id: candidateId }];
      }
      return [];
    });
    const { database, transaction } = transactionalDatabase(execute);

    const result = await resolveSourceCandidateIdentity(database, {
      ownerId,
      candidateId,
      observation,
    });

    expect(result).toMatchObject({
      status: "linked",
      leadId: existingLeadId,
      resolutionState: "duplicate",
      outboundProtection: { blocked: false, reason: null },
      decision: { outcome: "same_business" },
    });
    expect(transaction).toHaveBeenCalledOnce();

    const candidateLock = statements.find(({ sql }) =>
      sql.includes('from "lh_source_candidates"'));
    expect(candidateLock?.sql).toContain("for update of candidate");
    expect(candidateLock?.params).toEqual([ownerId, candidateId]);

    const advisoryLocks = statements.filter(({ sql }) =>
      sql.includes("pg_advisory_xact_lock"));
    expect(advisoryLocks.map(({ params }) => params[0])).toEqual([
      `${ownerId}:domain:acme.com.ar`,
      `${ownerId}:email:ventas@acme.com.ar`,
      `${ownerId}:name:acme distribuciones:ar`,
    ]);
    const possibleLeadQuery = statements.find(({ sql }) =>
      sql.includes('from "lh_leads"'));
    expect(possibleLeadQuery?.sql).toContain("like '%.' || candidate_domain.value");

    const candidateUpdate = statements.find(({ sql }) =>
      sql.includes('update "lh_source_candidates"'));
    expect(candidateUpdate?.sql).toContain("resolution_state = $");
    expect(candidateUpdate?.params).toContain("duplicate");
    expect(candidateUpdate?.sql).toContain('where "lh_source_candidates"."owner_id" =');
    expect(candidateUpdate?.sql).not.toContain("raw_record =");
    expect(candidateUpdate?.sql).not.toContain("canonical_url =");

    const activity = statements.find(({ sql }) =>
      sql.includes('insert into "lh_activity"'));
    expect(activity?.params).toEqual(expect.arrayContaining([
      ownerId,
      campaignId,
      existingLeadId,
      "identity.linked",
    ]));
    expect(JSON.parse(String(activity?.params.at(-1)))).toMatchObject({
      candidateId,
      outcome: "same_business",
      outboundBlocked: false,
    });
  });

  it("links a contacted business for enrichment but creates no new enrollment", async () => {
    const statements: string[] = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered.sql);
      if (rendered.sql.includes('from "lh_source_candidates"')) {
        return [pendingCandidate()];
      }
      if (rendered.sql.includes('from "lh_leads"')) return [existingLead()];
      if (rendered.sql.includes("as contacted")) {
        return [{ contacted: true, activeOutbound: false }];
      }
      if (rendered.sql.includes('update "lh_source_candidates"')) {
        return [{ id: candidateId }];
      }
      return [];
    });
    const { database } = transactionalDatabase(execute);

    const result = await resolveSourceCandidateIdentity(database, {
      ownerId,
      candidateId,
      observation,
    });

    expect(result).toMatchObject({
      status: "linked",
      leadId: existingLeadId,
      outboundProtection: {
        blocked: true,
        reason: "previously_contacted",
      },
    });
    expect(statements.some((sql) => sql.includes('insert into "lh_enrollments"')))
      .toBe(false);
  });

  it("queues ambiguous branch and parent matches for review without linking", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      if (rendered.sql.includes('from "lh_source_candidates"')) {
        return [pendingCandidate()];
      }
      if (rendered.sql.includes('from "lh_leads"')) {
        return [existingLead({ organizationRole: "parent" })];
      }
      if (rendered.sql.includes('update "lh_source_candidates"')) {
        return [{ id: candidateId }];
      }
      return [];
    });
    const { database } = transactionalDatabase(execute);

    const result = await resolveSourceCandidateIdentity(database, {
      ownerId,
      candidateId,
      observation: { ...observation, organizationRole: "branch" },
    });

    expect(result).toMatchObject({
      status: "needs_review",
      leadId: null,
      resolutionState: "needs_review",
      decision: { outcome: "needs_review" },
    });
    const update = statements.find(({ sql }) =>
      sql.includes('update "lh_source_candidates"'));
    expect(update?.sql).toContain("resolution_state = 'needs_review'");
    expect(update?.sql).not.toContain("lead_id =");
    expect(statements.some(({ sql }) => sql.includes('insert into "lh_leads"')))
      .toBe(false);
  });

  it("creates a distinct lead and enrollment when every existing comparison differs", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      if (rendered.sql.includes('from "lh_source_candidates"')) {
        return [pendingCandidate()];
      }
      if (rendered.sql.includes('from "lh_leads"')) {
        return [existingLead({
          name: "Another Business",
          normalizedName: "another business",
          domain: "another.example",
          website: "https://another.example",
          countryCode: "US",
          emails: [],
        })];
      }
      if (rendered.sql.includes('insert into "lh_leads"')) return [{ id: newLeadId }];
      if (rendered.sql.includes('update "lh_source_candidates"')) {
        return [{ id: candidateId }];
      }
      return [];
    });
    const { database } = transactionalDatabase(execute);

    const result = await resolveSourceCandidateIdentity(database, {
      ownerId,
      candidateId,
      observation: {
        ...observation,
        location: {
          ...observation.location,
          address: "San Martin 100",
        },
        organizationRole: "parent",
      },
    });

    expect(result).toMatchObject({
      status: "created",
      leadId: newLeadId,
      resolutionState: "resolved",
      outboundProtection: { blocked: false, reason: null },
      decision: { outcome: "different_business" },
    });
    expect(statements.some(({ sql }) => sql.includes('insert into "lh_enrollments"')))
      .toBe(true);
    const identityEvidence = statements.find(({ sql }) =>
      sql.includes('insert into "lh_evidence"'));
    expect(identityEvidence?.params).toEqual(expect.arrayContaining([
      ownerId,
      newLeadId,
      runId,
      campaignId,
      "https://acme.com.ar",
      "business.address",
      "San Martin 100",
      "business.organization_role",
      "parent",
    ]));
    expect(statements.some(({ sql }) => sql.includes('insert into "lh_activity"')))
      .toBe(true);
  });

  it("returns an already processed candidate without repeating mutations", async () => {
    const statements: string[] = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered.sql);
      if (rendered.sql.includes('from "lh_source_candidates"')) {
        return [{
          ...pendingCandidate(),
          resolutionState: "duplicate",
          leadId: existingLeadId,
        }];
      }
      if (rendered.sql.includes("as contacted")) {
        return [{ contacted: true, activeOutbound: false }];
      }
      return [];
    });
    const { database } = transactionalDatabase(execute);

    const result = await resolveSourceCandidateIdentity(database, {
      ownerId,
      candidateId,
      observation,
    });

    expect(result).toMatchObject({
      status: "already_processed",
      leadId: existingLeadId,
      resolutionState: "duplicate",
      outboundProtection: {
        blocked: true,
        reason: "previously_contacted",
      },
    });
    expect(statements.some((sql) => /^(insert|update)/i.test(sql.trim()))).toBe(false);
  });

  it("rejects an unknown or foreign candidate before any resolution work", async () => {
    const statements: string[] = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered.sql);
      return [];
    });
    const { database } = transactionalDatabase(execute);

    await expect(resolveSourceCandidateIdentity(database, {
      ownerId,
      candidateId,
      observation,
    })).rejects.toThrow("Source candidate not found");
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("for update of candidate");
  });
});
