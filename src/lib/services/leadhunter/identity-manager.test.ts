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

function persistedRawRecord(identity: BusinessIdentity = observation) {
  return {
    sourceUrl: "https://acme.com.ar",
    observedUrl: "https://acme.com.ar",
    providerRank: 1,
    observedName: identity.name,
    observedLocation: identity.location.city ?? null,
    metadata: { identity },
  };
}

function pendingCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: candidateId,
    runId,
    resolutionState: "pending",
    leadId: null,
    campaignId,
    campaignVersion: 3,
    rawRecord: persistedRawRecord(),
    canonicalUrl: "https://acme.com.ar",
    sourceType: "web_search",
    ...overrides,
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
      if (rendered.sql.includes('from "lh_leads" as lead')) return [existingLead()];
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
      decision: { outcome: "same" },
    });
    expect(transaction).toHaveBeenCalledOnce();

    const candidateLock = statements.find(({ sql }) =>
      sql.includes('from "lh_source_candidates"') && sql.includes("for update"));
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
      sql.includes('from "lh_leads" as lead'));
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
      outcome: "same",
      outboundBlocked: false,
    });
  });

  it("links a converted business for enrichment but creates no new enrollment", async () => {
    const statements: string[] = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered.sql);
      if (rendered.sql.includes('from "lh_source_candidates"')) {
        return [pendingCandidate()];
      }
      if (rendered.sql.includes('from "lh_leads" as lead')) return [existingLead()];
      if (rendered.sql.includes("as contacted")) {
        return [{
          convertedOrClient: true,
          suppressed: false,
          contacted: false,
          activeOutbound: false,
        }];
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
        reason: "converted_or_client",
      },
    });
    expect(statements.some((sql) => sql.includes('insert into "lh_enrollments"')))
      .toBe(false);
    expect(statements.some((sql) => sql.includes('insert into "lh_activity"')))
      .toBe(true);
  });

  it("queues ambiguous branch and parent matches for review without linking", async () => {
    const branchObservation: BusinessIdentity = {
      ...observation,
      organizationRole: "branch",
    };
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      if (rendered.sql.includes('from "lh_source_candidates"')) {
        return [pendingCandidate({ rawRecord: persistedRawRecord(branchObservation) })];
      }
      if (rendered.sql.includes('from "lh_leads" as lead')) {
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
      observation: branchObservation,
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
    const parentObservation: BusinessIdentity = {
      ...observation,
      location: {
        ...observation.location,
        address: "San Martin 100",
      },
      organizationRole: "parent",
    };
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      if (rendered.sql.includes('from "lh_source_candidates"')) {
        return [pendingCandidate({ rawRecord: persistedRawRecord(parentObservation) })];
      }
      if (rendered.sql.includes('from "lh_leads" as lead')) {
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
      observation: parentObservation,
    });

    expect(result).toMatchObject({
      status: "created",
      leadId: newLeadId,
      resolutionState: "resolved",
      outboundProtection: { blocked: false, reason: null },
      decision: { outcome: "different" },
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
    expect(statements[0]).not.toContain("for update");
  });

  it("rejects a manipulated observation before identity locks or lead lookups", async () => {
    const statements: string[] = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered.sql);
      if (rendered.sql.includes('from "lh_source_candidates"')) {
        return [pendingCandidate()];
      }
      return [];
    });
    const { database } = transactionalDatabase(execute);

    await expect(resolveSourceCandidateIdentity(database, {
      ownerId,
      candidateId,
      observation: {
        ...observation,
        name: "Manipulated Business",
        emails: ["attacker@example.com"],
      },
    })).rejects.toThrow("does not match persisted provenance");

    expect(statements).toHaveLength(1);
    expect(statements[0]).not.toContain('from "lh_leads"');
  });

  it("rejects unknown observation fields before identity work", async () => {
    const statements: string[] = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered.sql);
      if (rendered.sql.includes('from "lh_source_candidates"')) {
        return [pendingCandidate()];
      }
      return [];
    });
    const { database } = transactionalDatabase(execute);

    await expect(resolveSourceCandidateIdentity(database, {
      ownerId,
      candidateId,
      observation: {
        ...observation,
        injectedOwnerId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      } as BusinessIdentity,
    })).rejects.toThrow();
    expect(statements).toHaveLength(0);
  });

  it("does not treat an unclassified adapter URL as an official-domain match", async () => {
    const directoryUrl = "https://directory.example.com/listing/business-one";
    const adapterRawRecord = {
      sourceUrl: directoryUrl,
      observedUrl: directoryUrl,
      providerRank: 2,
      observedName: "Business One",
      observedLocation: "Miami",
      metadata: {
        engine: "brave",
        snippet: "Public directory listing",
        snippetTrust: "untrusted",
      },
    };
    const derivedObservation: BusinessIdentity = {
      name: "Business One",
      emails: [],
      urls: [{ url: directoryUrl, role: "directory" }],
      location: { city: "Miami" },
      organizationRole: "unknown",
    };
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      if (rendered.sql.includes('from "lh_source_candidates"')) {
        return [pendingCandidate({
          rawRecord: adapterRawRecord,
          canonicalUrl: directoryUrl,
        })];
      }
      if (rendered.sql.includes('from "lh_leads" as lead')) {
        return [existingLead({
          name: "Business Two",
          normalizedName: "business two",
          domain: "example.com",
          website: "https://directory.example.com/listing/business-two",
          countryCode: null,
          city: "Miami",
          emails: [],
        })];
      }
      if (rendered.sql.includes("as contacted")) {
        return [{
          convertedOrClient: false,
          suppressed: false,
          contacted: false,
          activeOutbound: false,
        }];
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
      observation: derivedObservation,
    });

    expect(result).toMatchObject({
      status: "created",
      leadId: newLeadId,
      decision: { outcome: "different" },
    });
    expect(statements.some(({ sql, params }) => (
      sql.includes('update "lh_source_candidates"') && params.includes("duplicate")
    ))).toBe(false);
  });

  it("rejects relabeling an unclassified adapter URL as official", async () => {
    const directoryUrl = "https://directory.example.com/listing/business-one";
    const statements: string[] = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered.sql);
      if (rendered.sql.includes('from "lh_source_candidates"')) {
        return [pendingCandidate({
          rawRecord: {
            sourceUrl: directoryUrl,
            observedUrl: directoryUrl,
            providerRank: 2,
            observedName: "Business One",
            observedLocation: null,
            metadata: {
              engine: "brave",
              snippet: "Public directory listing",
              snippetTrust: "untrusted",
            },
          },
          canonicalUrl: directoryUrl,
        })];
      }
      return [];
    });
    const { database } = transactionalDatabase(execute);

    await expect(resolveSourceCandidateIdentity(database, {
      ownerId,
      candidateId,
      observation: {
        name: "Business One",
        emails: [],
        urls: [{ url: directoryUrl, role: "official_website" }],
        location: {},
        organizationRole: "unknown",
      },
    })).rejects.toThrow("does not match persisted provenance");
    expect(statements).toHaveLength(1);
    expect(statements[0]).not.toContain("for update");
  });

  it.each([
    {
      label: "seed URL",
      sourceType: "seed_url",
      url: "https://seed-business.example/",
      rawRecord: {
        sourceUrl: "https://seed-business.example/",
        observedUrl: "https://seed-business.example/",
        providerRank: 1,
        observedName: null,
        observedLocation: null,
        metadata: { workId: "seed:1" },
      },
    },
    {
      label: "SearXNG result without a title",
      sourceType: "web_search",
      url: "https://directory.example/listing/nameless-business",
      rawRecord: {
        sourceUrl: "https://directory.example/listing/nameless-business",
        observedUrl: "https://directory.example/listing/nameless-business",
        providerRank: 1,
        observedName: null,
        observedLocation: null,
        metadata: {},
      },
    },
  ])("durably reviews a nameless $label without creating or dispatching", async ({
    sourceType,
    url,
    rawRecord,
  }) => {
    let resolutionState = "pending";
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      const rendered = queryText(query);
      statements.push(rendered);
      if (rendered.sql.includes('from "lh_source_candidates"')) {
        return [pendingCandidate({
          sourceType,
          rawRecord,
          canonicalUrl: url,
          resolutionState,
        })];
      }
      if (rendered.sql.includes('from "lh_leads" as lead')) return [];
      if (rendered.sql.includes('update "lh_source_candidates"')) {
        resolutionState = "needs_review";
        return [{ id: candidateId }];
      }
      return [];
    });
    const { database } = transactionalDatabase(execute);
    const namelessObservation: BusinessIdentity = {
      name: null,
      emails: [],
      urls: [{ url, role: "directory" }],
      location: {},
      organizationRole: "unknown",
    };

    const first = await resolveSourceCandidateIdentity(database, {
      ownerId,
      candidateId,
      observation: namelessObservation,
    });
    const repeated = await resolveSourceCandidateIdentity(database, {
      ownerId,
      candidateId,
      observation: namelessObservation,
    });

    expect(first).toMatchObject({
      status: "needs_review",
      leadId: null,
      resolutionState: "needs_review",
      decision: {
        outcome: "needs_review",
        reasons: ["missing_business_name"],
      },
    });
    expect(repeated).toMatchObject({
      status: "already_processed",
      leadId: null,
      resolutionState: "needs_review",
      decision: null,
    });
    expect(statements.filter(({ sql }) => sql.includes('insert into "lh_activity"')))
      .toHaveLength(1);
    const activity = statements.find(({ sql }) => sql.includes('insert into "lh_activity"'));
    expect(activity?.params).toEqual(expect.arrayContaining([
      ownerId,
      campaignId,
      "identity.needs_review",
    ]));
    expect(JSON.parse(String(activity?.params.at(-1)))).toMatchObject({
      candidateId,
      outcome: "needs_review",
      reasons: ["missing_business_name"],
      missingFields: ["name"],
    });
    expect(statements.some(({ sql }) => sql.includes('insert into "lh_leads"')))
      .toBe(false);
    expect(statements.some(({ sql }) => sql.includes('insert into "lh_enrollments"')))
      .toBe(false);
    expect(statements.some(({ sql }) => sql.includes('insert into "lh_outbox"')))
      .toBe(false);
  });
});
