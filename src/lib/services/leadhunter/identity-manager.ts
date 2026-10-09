import "server-only";

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import * as schema from "@/db/schema";
import {
  leadHunterActivities,
  leadHunterContacts,
  leadHunterEnrollments,
  leadHunterEvidence,
  leadHunterLeads,
  leadHunterRuns,
  leadHunterSourceCandidates,
} from "@/db/schema";
import {
  normalizeIdentityEmail,
  normalizeIdentityText,
  registrableDomainForOfficialUrl,
  resolveBusinessIdentity,
  businessIdentitySchema,
  type BusinessIdentity,
  type IdentityResolution,
  type OrganizationRole,
} from "@/lib/leadhunter/identity";
import {
  acquireLeadOutboundTransitionLock,
  getLeadOutboundProtection,
  type LeadOutboundProtection,
} from "./lead-manager";

export type LeadHunterIdentityTransaction = Pick<
  PostgresJsDatabase<typeof schema>,
  "execute"
>;

export interface LeadHunterIdentityDatabase {
  transaction<T>(
    operation: (database: LeadHunterIdentityTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface ResolveSourceCandidateIdentityInput {
  ownerId: string;
  candidateId: string;
  observation: unknown;
  /** A separate observation captured by the server, never a rewrite of discovery. */
  publishedNameEvidence?: { name: string; sourceUrl: string; suppliedAt: string; contentSha256: string };
}

const publishedNameEvidenceSchema = z.object({
  name: z.string().trim().min(1).max(200), sourceUrl: z.string().url(),
  suppliedAt: z.string().datetime({ offset: true }), contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export function identityWithPublishedName(identity: BusinessIdentity, canonicalUrl: string | null, raw: unknown): BusinessIdentity {
  if (raw === undefined || identity.name) return identity;
  const evidence = publishedNameEvidenceSchema.parse(raw);
  if (evidence.sourceUrl !== canonicalUrl || !identity.urls.some(({ url, role }) => role === "official_website" && url === evidence.sourceUrl)) {
    throw new TypeError("Published name must come from the discovered official source");
  }
  return { ...identity, name: evidence.name };
}

type CandidateResolutionState =
  | "pending"
  | "resolved"
  | "duplicate"
  | "needs_review"
  | "rejected";

export interface ResolveSourceCandidateIdentityResult {
  status: "linked" | "created" | "needs_review" | "already_processed";
  leadId: string | null;
  resolutionState: CandidateResolutionState;
  decision: IdentityResolution | null;
  outboundProtection: LeadOutboundProtection;
}

interface CandidateRow {
  id: string;
  runId: string;
  resolutionState: CandidateResolutionState;
  leadId: string | null;
  campaignId: string;
  campaignVersion: number;
  rawRecord: Record<string, unknown>;
  canonicalUrl: string | null;
  sourceType: string;
}

interface ExistingLeadRow {
  id: string;
  name: string;
  normalizedName: string;
  domain: string | null;
  website: string | null;
  countryCode: string | null;
  city: string | null;
  emails: unknown;
  address: string | null;
  organizationRole: string | null;
  parentName: string | null;
}

interface InsertedRow {
  id: string;
}

interface Comparison {
  lead: ExistingLeadRow;
  decision: IdentityResolution;
}

const allowedOrganizationRoles = new Set<OrganizationRole>([
  "branch",
  "parent",
  "independent",
  "unknown",
]);

const noProtection: LeadOutboundProtection = { blocked: false, reason: null };

const provenanceUrlSchema = z.string().url().max(2_048).refine(
  (value) => /^https?:\/\//i.test(value),
  "Source provenance URL must use HTTP(S)",
);

const candidateRawRecordSchema = z.object({
  sourceUrl: provenanceUrlSchema,
  observedUrl: provenanceUrlSchema,
  providerRank: z.number().int().positive(),
  observedName: z.string().trim().min(1).max(240).nullable(),
  observedLocation: z.string().trim().min(1).max(500).nullable(),
  metadata: z.record(z.string(), z.unknown()),
}).strict();

function organizationRole(value: string | null): OrganizationRole {
  return value && allowedOrganizationRoles.has(value as OrganizationRole)
    ? value as OrganizationRole
    : "unknown";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function identityForLead(lead: ExistingLeadRow): BusinessIdentity {
  const urls = [...new Set([
    lead.website,
    lead.domain ? `https://${lead.domain}` : null,
  ].filter((value): value is string => value !== null))];
  return {
    name: lead.name,
    emails: stringArray(lead.emails),
    urls: urls.map((url) => ({ url, role: "official_website" as const })),
    location: {
      countryCode: lead.countryCode,
      city: lead.city,
      address: lead.address,
    },
    organizationRole: organizationRole(lead.organizationRole),
    parentName: lead.parentName,
  };
}

function comparableIdentity(identity: BusinessIdentity): string {
  return JSON.stringify({
    name: identity.name,
    emails: [...identity.emails].sort(),
    urls: identity.urls
      .map(({ url, role }) => ({ url: new URL(url).toString(), role }))
      .sort((left, right) => `${left.role}:${left.url}`.localeCompare(`${right.role}:${right.url}`)),
    location: {
      countryCode: identity.location.countryCode ?? null,
      city: identity.location.city ?? null,
      address: identity.location.address ?? null,
    },
    organizationRole: identity.organizationRole,
    parentName: identity.parentName ?? null,
  });
}

function identityFromProvenance(candidate: CandidateRow): BusinessIdentity {
  const raw = candidateRawRecordSchema.parse(candidate.rawRecord);
  const persistedIdentity = raw.metadata.identity;
  if (persistedIdentity !== undefined) {
    const identity = businessIdentitySchema.parse(persistedIdentity);
    if (
      raw.observedName
      && identity.name
      && normalizeIdentityText(raw.observedName) !== normalizeIdentityText(identity.name)
    ) {
      throw new TypeError("Persisted identity conflicts with source candidate provenance");
    }
    return identity;
  }

  const sourceUrl = candidate.canonicalUrl ?? raw.observedUrl;
  return businessIdentitySchema.parse({
    name: raw.observedName,
    emails: [],
    urls: [{ url: sourceUrl, role: "directory" }],
    location: raw.observedLocation ? { city: raw.observedLocation } : {},
    organizationRole: "unknown",
  });
}

function reconcileObservation(
  candidate: CandidateRow,
  supplied: BusinessIdentity,
): BusinessIdentity {
  const persisted = identityFromProvenance(candidate);
  if (comparableIdentity(persisted) !== comparableIdentity(supplied)) {
    throw new TypeError("Supplied identity does not match persisted provenance");
  }
  return persisted;
}

function officialWebsites(identity: BusinessIdentity): string[] {
  return identity.urls
    .filter(({ role }) => role === "official_website")
    .map(({ url }) => url);
}

function officialDomains(identity: BusinessIdentity): string[] {
  return [...new Set(officialWebsites(identity)
    .map(registrableDomainForOfficialUrl)
    .filter((value): value is string => value !== null))]
    .sort();
}

function normalizedEmails(identity: BusinessIdentity): string[] {
  return [...new Set(identity.emails.map(normalizeIdentityEmail).filter(Boolean))].sort();
}

function identityLockKeys(ownerId: string, identity: BusinessIdentity): string[] {
  const keys = [
    ...officialDomains(identity).map((domain) => `${ownerId}:domain:${domain}`),
    ...normalizedEmails(identity).map((email) => `${ownerId}:email:${email}`),
  ];
  const name = normalizeIdentityText(identity.name);
  if (name) {
    keys.push(
      `${ownerId}:name:${name}:${normalizeIdentityText(identity.location.countryCode)}`,
    );
  }
  return [...new Set(keys)].sort();
}

function emptyIdentity(): BusinessIdentity {
  return {
    name: null,
    emails: [],
    urls: [],
    location: {},
    organizationRole: "unknown",
  };
}

function activityComparisons(comparisons: readonly Comparison[]) {
  return comparisons.map(({ lead, decision }) => ({
    leadId: lead.id,
    outcome: decision.outcome,
    reasons: decision.reasons,
  }));
}

async function recordActivity(
  transaction: LeadHunterIdentityTransaction,
  input: {
    ownerId: string;
    campaignId: string;
    leadId: string | null;
    eventType: "identity.linked" | "identity.created" | "identity.needs_review" | "identity.name_observed";
    detail: Record<string, unknown>;
  },
) {
  await transaction.execute(sql`
    insert into ${leadHunterActivities} (
      owner_id,
      campaign_id,
      lead_id,
      actor_type,
      event_type,
      detail
    ) values (
      ${input.ownerId},
      ${input.campaignId},
      ${input.leadId},
      'system',
      ${input.eventType},
      ${JSON.stringify(input.detail)}::jsonb
    )
  `);
}

async function updateCandidate(
  transaction: LeadHunterIdentityTransaction,
  input: {
    ownerId: string;
    candidateId: string;
    resolutionState: "resolved" | "duplicate";
    leadId: string;
  },
) {
  const rows = await transaction.execute(sql<InsertedRow>`
    update ${leadHunterSourceCandidates}
    set
      resolution_state = ${input.resolutionState},
      lead_id = ${input.leadId}
    where ${leadHunterSourceCandidates.ownerId} = ${input.ownerId}
      and ${leadHunterSourceCandidates.id} = ${input.candidateId}
      and ${leadHunterSourceCandidates.resolutionState} = 'pending'
    returning ${leadHunterSourceCandidates.id}
  `) as unknown as InsertedRow[];
  if (!rows[0]) throw new Error("Source candidate resolution changed concurrently");
}

async function queueForReview(
  transaction: LeadHunterIdentityTransaction,
  ownerId: string,
  candidateId: string,
) {
  const rows = await transaction.execute(sql<InsertedRow>`
    update ${leadHunterSourceCandidates}
    set resolution_state = 'needs_review'
    where ${leadHunterSourceCandidates.ownerId} = ${ownerId}
      and ${leadHunterSourceCandidates.id} = ${candidateId}
      and ${leadHunterSourceCandidates.resolutionState} = 'pending'
    returning ${leadHunterSourceCandidates.id}
  `) as unknown as InsertedRow[];
  if (!rows[0]) throw new Error("Source candidate resolution changed concurrently");
}

async function ensureEnrollment(
  transaction: LeadHunterIdentityTransaction,
  input: {
    ownerId: string;
    campaignId: string;
    campaignVersion: number;
    leadId: string;
  },
) {
  await transaction.execute(sql`
    insert into ${leadHunterEnrollments} (
      owner_id,
      campaign_id,
      lead_id,
      campaign_version,
      evaluation,
      status
    ) values (
      ${input.ownerId},
      ${input.campaignId},
      ${input.leadId},
      ${input.campaignVersion},
      'pending',
      'researching'
    )
    on conflict (owner_id, campaign_id, lead_id) do nothing
  `);
}

async function ensureEnrollmentIfOutboundAllowed(
  transaction: LeadHunterIdentityTransaction,
  input: {
    ownerId: string;
    campaignId: string;
    campaignVersion: number;
    leadId: string;
  },
): Promise<LeadOutboundProtection> {
  await acquireLeadOutboundTransitionLock(
    transaction,
    input.ownerId,
    input.leadId,
  );
  const protection = await getLeadOutboundProtection(
    transaction,
    input.ownerId,
    input.leadId,
  );
  if (!protection.blocked) await ensureEnrollment(transaction, input);
  return protection;
}

async function createDistinctLead(
  transaction: LeadHunterIdentityTransaction,
  provenance: {
    ownerId: string;
    runId: string;
    campaignId: string;
    sourceUrl: string | null;
  },
  identity: BusinessIdentity,
): Promise<string> {
  const name = identity.name?.trim();
  if (!name) throw new TypeError("Business identity name is required to create a lead");
  const websites = officialWebsites(identity);
  const domains = officialDomains(identity);
  const rows = await transaction.execute(sql<InsertedRow>`
    insert into ${leadHunterLeads} (
      owner_id,
      name,
      normalized_name,
      domain,
      website,
      country_code,
      city,
      status
    ) values (
      ${provenance.ownerId},
      ${name},
      ${normalizeIdentityText(name)},
      ${domains[0] ?? null},
      ${websites[0] ?? null},
      ${identity.location.countryCode?.trim().toUpperCase() || null},
      ${identity.location.city?.trim() || null},
      'new'
    )
    returning ${leadHunterLeads.id}
  `) as unknown as InsertedRow[];
  const lead = rows[0];
  if (!lead) throw new Error("Lead insert did not return an id");

  const primaryEmail = normalizedEmails(identity)[0];
  if (primaryEmail) {
    await transaction.execute(sql`
      insert into ${leadHunterContacts} (
        owner_id,
        lead_id,
        email,
        normalized_email,
        source_type,
        is_primary
      ) values (
        ${provenance.ownerId},
        ${lead.id},
        ${primaryEmail},
        ${primaryEmail},
        'identity_resolution',
        true
      )
      on conflict (owner_id, normalized_email)
        where normalized_email is not null
      do nothing
    `);
  }

  const identityEvidence = [
    ["business.address", identity.location.address?.trim()],
    [
      "business.organization_role",
      identity.organizationRole === "unknown" ? undefined : identity.organizationRole,
    ],
    ["business.parent_name", identity.parentName?.trim()],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]));
  if (identityEvidence.length > 0) {
    const values = identityEvidence.map(([field, value]) => sql`(
      ${provenance.ownerId},
      ${lead.id},
      ${provenance.runId},
      ${provenance.campaignId},
      'hypothesis',
      'inferred',
      'identity_resolution',
      ${provenance.sourceUrl},
      ${field},
      ${value},
      70
    )`);
    await transaction.execute(sql`
      insert into ${leadHunterEvidence} (
        owner_id,
        lead_id,
        run_id,
        campaign_id,
        kind,
        status,
        source_type,
        source_url,
        field,
        value,
        confidence
      ) values ${sql.join(values, sql`, `)}
    `);
  }
  return lead.id;
}

export async function resolveSourceCandidateIdentity(
  database: LeadHunterIdentityDatabase,
  input: ResolveSourceCandidateIdentityInput,
): Promise<ResolveSourceCandidateIdentityResult> {
  const suppliedObservation = businessIdentitySchema.parse(input.observation);
  return database.transaction(async (transaction) => {
    const preflightRows = await transaction.execute(sql<CandidateRow>`
      select
        candidate.id,
        candidate.run_id as "runId",
        candidate.resolution_state as "resolutionState",
        candidate.lead_id as "leadId",
        candidate.raw_record as "rawRecord",
        candidate.canonical_url as "canonicalUrl",
        candidate.source_type as "sourceType",
        run.campaign_id as "campaignId",
        run.campaign_version as "campaignVersion"
      from ${leadHunterSourceCandidates} as candidate
      inner join ${leadHunterRuns} as run
        on run.owner_id = candidate.owner_id
       and run.id = candidate.run_id
      where candidate.owner_id = ${input.ownerId}
        and candidate.id = ${input.candidateId}
    `) as unknown as CandidateRow[];
    const preflight = preflightRows[0];
    if (!preflight) throw new Error("Source candidate not found");
    const identity = identityWithPublishedName(reconcileObservation(preflight, suppliedObservation), preflight.canonicalUrl, input.publishedNameEvidence);

    const candidateRows = await transaction.execute(sql<CandidateRow>`
      select
        candidate.id,
        candidate.run_id as "runId",
        candidate.resolution_state as "resolutionState",
        candidate.lead_id as "leadId",
        candidate.raw_record as "rawRecord",
        candidate.canonical_url as "canonicalUrl",
        candidate.source_type as "sourceType",
        run.campaign_id as "campaignId",
        run.campaign_version as "campaignVersion"
      from ${leadHunterSourceCandidates} as candidate
      inner join ${leadHunterRuns} as run
        on run.owner_id = candidate.owner_id
       and run.id = candidate.run_id
      where candidate.owner_id = ${input.ownerId}
        and candidate.id = ${input.candidateId}
      for update of candidate
    `) as unknown as CandidateRow[];
    const candidate = candidateRows[0];
    if (!candidate) throw new Error("Source candidate not found");
    reconcileObservation(candidate, suppliedObservation);

    if (candidate.resolutionState !== "pending") {
      const outboundProtection = candidate.leadId
        ? await getLeadOutboundProtection(transaction, input.ownerId, candidate.leadId)
        : noProtection;
      return {
        status: "already_processed",
        leadId: candidate.leadId,
        resolutionState: candidate.resolutionState,
        decision: null,
        outboundProtection,
      };
    }

    if (input.publishedNameEvidence && !suppliedObservation.name) {
      await recordActivity(transaction, {
        ownerId: input.ownerId, campaignId: candidate.campaignId, leadId: null,
        eventType: "identity.name_observed",
        detail: { candidateId: candidate.id, ...publishedNameEvidenceSchema.parse(input.publishedNameEvidence) },
      });
    }

    const lockKeys = identityLockKeys(input.ownerId, identity);
    if (lockKeys.length === 0) lockKeys.push(`${input.ownerId}:candidate:${input.candidateId}`);
    for (const lockKey of lockKeys) {
      await transaction.execute(sql`
        select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
      `);
    }

    const name = normalizeIdentityText(identity.name);
    const domains = officialDomains(identity);
    const emails = normalizedEmails(identity);
    const possibleLeads = await transaction.execute(sql<ExistingLeadRow>`
      select
        lead.id,
        lead.name,
        lead.normalized_name as "normalizedName",
        lead.domain,
        lead.website,
        lead.country_code as "countryCode",
        lead.city,
        coalesce((
          select jsonb_agg(contact.normalized_email order by contact.normalized_email)
          from ${leadHunterContacts} as contact
          where contact.owner_id = lead.owner_id
            and contact.lead_id = lead.id
            and contact.normalized_email is not null
        ), '[]'::jsonb) as emails,
        (
          select evidence.value
          from ${leadHunterEvidence} as evidence
          where evidence.owner_id = lead.owner_id
            and evidence.lead_id = lead.id
            and evidence.field = 'business.address'
          order by evidence.observed_at desc, evidence.id desc
          limit 1
        ) as address,
        (
          select evidence.value
          from ${leadHunterEvidence} as evidence
          where evidence.owner_id = lead.owner_id
            and evidence.lead_id = lead.id
            and evidence.field = 'business.organization_role'
          order by evidence.observed_at desc, evidence.id desc
          limit 1
        ) as "organizationRole",
        (
          select evidence.value
          from ${leadHunterEvidence} as evidence
          where evidence.owner_id = lead.owner_id
            and evidence.lead_id = lead.id
            and evidence.field = 'business.parent_name'
          order by evidence.observed_at desc, evidence.id desc
          limit 1
        ) as "parentName"
      from ${leadHunterLeads} as lead
      where lead.owner_id = ${input.ownerId}
        and (
          (${name} <> '' and (
            lead.normalized_name = ${name}
            or lead.normalized_name like ${`${name} %`}
            or ${name} like lead.normalized_name || ' %'
          ))
          or exists (
            select 1
            from jsonb_array_elements_text(
              ${JSON.stringify(domains)}::jsonb
            ) as candidate_domain(value)
            where lower(coalesce(lead.domain, '')) = candidate_domain.value
               or lower(coalesce(lead.domain, '')) like '%.' || candidate_domain.value
          )
          or exists (
            select 1
            from ${leadHunterContacts} as contact_match
            where contact_match.owner_id = lead.owner_id
              and contact_match.lead_id = lead.id
              and contact_match.normalized_email in (
                select jsonb_array_elements_text(${JSON.stringify(emails)}::jsonb)
              )
          )
        )
      order by lead.id
      limit 100
      for update of lead
    `) as unknown as ExistingLeadRow[];

    const comparisons = possibleLeads.map((lead) => ({
      lead,
      decision: resolveBusinessIdentity(identity, identityForLead(lead)),
    }));
    const same = comparisons.filter(({ decision }) =>
      decision.outcome === "same");
    const review = comparisons.filter(({ decision }) =>
      decision.outcome === "needs_review");

    if (same.length === 1) {
      const match = same[0]!;
      const outboundProtection = await ensureEnrollmentIfOutboundAllowed(
        transaction,
        {
          ownerId: input.ownerId,
          campaignId: candidate.campaignId,
          campaignVersion: candidate.campaignVersion,
          leadId: match.lead.id,
        },
      );
      await updateCandidate(transaction, {
        ownerId: input.ownerId,
        candidateId: input.candidateId,
        resolutionState: "duplicate",
        leadId: match.lead.id,
      });
      await recordActivity(transaction, {
        ownerId: input.ownerId,
        campaignId: candidate.campaignId,
        leadId: match.lead.id,
        eventType: "identity.linked",
        detail: {
          candidateId: input.candidateId,
          outcome: match.decision.outcome,
          reasons: match.decision.reasons,
          comparisons: activityComparisons(comparisons),
          enrichmentOnly: outboundProtection.blocked,
          outboundBlocked: outboundProtection.blocked,
          outboundBlockReason: outboundProtection.reason,
        },
      });
      return {
        status: "linked",
        leadId: match.lead.id,
        resolutionState: "duplicate",
        decision: match.decision,
        outboundProtection,
      };
    }

    if (same.length > 1 || review.length > 0) {
      const decision = review[0]?.decision ?? {
        outcome: "needs_review" as const,
        signals: [],
        reasons: [],
      };
      await queueForReview(transaction, input.ownerId, input.candidateId);
      await recordActivity(transaction, {
        ownerId: input.ownerId,
        campaignId: candidate.campaignId,
        leadId: null,
        eventType: "identity.needs_review",
        detail: {
          candidateId: input.candidateId,
          outcome: "needs_review",
          reasons: decision.reasons,
          comparisons: activityComparisons(comparisons),
          possibleLeadIds: comparisons
            .filter(({ decision: item }) => item.outcome !== "different")
            .map(({ lead }) => lead.id),
        },
      });
      return {
        status: "needs_review",
        leadId: null,
        resolutionState: "needs_review",
        decision: { ...decision, outcome: "needs_review" },
        outboundProtection: noProtection,
      };
    }

    if (!identity.name) {
      const decision: IdentityResolution = {
        outcome: "needs_review",
        signals: [{ code: "missing_business_name", effect: "review" }],
        reasons: ["missing_business_name"],
      };
      await queueForReview(transaction, input.ownerId, input.candidateId);
      await recordActivity(transaction, {
        ownerId: input.ownerId,
        campaignId: candidate.campaignId,
        leadId: null,
        eventType: "identity.needs_review",
        detail: {
          candidateId: input.candidateId,
          outcome: decision.outcome,
          reasons: decision.reasons,
          comparisons: activityComparisons(comparisons),
          possibleLeadIds: [],
          missingFields: ["name"],
        },
      });
      return {
        status: "needs_review",
        leadId: null,
        resolutionState: "needs_review",
        decision,
        outboundProtection: noProtection,
      };
    }

    const leadId = await createDistinctLead(
      transaction,
      {
        ownerId: input.ownerId,
        runId: candidate.runId,
        campaignId: candidate.campaignId,
        sourceUrl: candidate.canonicalUrl,
      },
      identity,
    );
    const outboundProtection = await ensureEnrollmentIfOutboundAllowed(transaction, {
      ownerId: input.ownerId,
      campaignId: candidate.campaignId,
      campaignVersion: candidate.campaignVersion,
      leadId,
    });
    await updateCandidate(transaction, {
      ownerId: input.ownerId,
      candidateId: input.candidateId,
      resolutionState: "resolved",
      leadId,
    });
    const decision = comparisons[0]?.decision
      ?? resolveBusinessIdentity(identity, emptyIdentity());
    await recordActivity(transaction, {
      ownerId: input.ownerId,
      campaignId: candidate.campaignId,
      leadId,
      eventType: "identity.created",
      detail: {
        candidateId: input.candidateId,
        outcome: "different",
        reasons: decision.reasons,
        comparisons: activityComparisons(comparisons),
        outboundBlocked: outboundProtection.blocked,
        outboundBlockReason: outboundProtection.reason,
      },
    });
    return {
      status: "created",
      leadId,
      resolutionState: "resolved",
      decision: { ...decision, outcome: "different" },
      outboundProtection,
    };
  });
}
