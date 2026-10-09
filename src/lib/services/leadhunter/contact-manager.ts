import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getDomain } from "tldts";
import { z } from "zod";

import * as schema from "@/db/schema";
import {
  leadHunterActivities,
  leadHunterCampaigns,
  leadHunterCampaignVersions,
  leadHunterContacts,
  leadHunterEnrollments,
  leadHunterJobs,
  leadHunterLeads,
  leadHunterRuns,
  leadHunterSourceCandidates,
} from "@/db/schema";
import {
  contactEnrichmentEnvelopeSchema,
  contactEnrichmentPayloadSchema,
  deriveContactSelection,
  normalizePublishedEmail,
  type ContactSelection,
  type SelectedContact,
  type TrustedContactSource,
} from "@/lib/leadhunter/contact-enrichment";
import {
  databaseDate,
  digestLeaseToken,
  exactDigestMatch,
  JobCompletionRejectedError,
  settleLeadHunterRun,
} from "./job-manager";
import {
  acquireLeadOutboundTransitionLock,
  getLeadOutboundProtection,
} from "./lead-manager";

export type LeadHunterContactTransaction = Pick<
  PostgresJsDatabase<typeof schema>,
  "execute"
>;

export interface LeadHunterContactDatabase {
  transaction<T>(
    operation: (database: LeadHunterContactTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface PersistContactEnrichmentInput {
  ownerId: string;
  jobId: string;
  leaseToken: string;
  now: Date;
  output: unknown;
}

export interface PersistContactEnrichmentResult {
  status: "processed" | "already_processed" | "rejected";
  outcome: ContactSelection["outcome"] | null;
  contactIds: string[];
  primaryContactId: string | null;
  outboundBlocked: boolean;
}

interface JobRow {
  id: string;
  runId: string;
  enrollmentId: string | null;
  leadId: string | null;
  state: "queued" | "leased" | "succeeded" | "failed" | "cancelled";
  kind: string;
  payload: unknown;
  result: unknown;
  leaseTokenDigest: string | null;
  leaseExpiresAt: Date | string | null;
  leaseOwner: string | null;
}

interface LeadRow {
  status: string;
  domain: string | null;
  website: string | null;
}

interface EnrollmentRow {
  campaignId: string;
  campaignVersion: number;
  evaluation: string;
  enrollmentStatus: string;
}

interface CampaignRow {
  currentCampaignVersion: number;
}

interface CandidateRow {
  id: string;
  sourceType: string;
  canonicalUrl: string | null;
  resolutionState: string;
  leadId: string | null;
}

interface ExistingContactRow {
  id: string;
  leadId: string;
  email: string | null;
  normalizedEmail: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  sourceUrl: string | null;
  sourceType: string | null;
  emailConfidence: number | null;
  verifiedAt: Date | string | null;
  isPrimary: boolean;
}

interface StoredResult {
  kind: "enrich_contact";
  output: {
    outcome: ContactSelection["outcome"];
    contactIds: string[];
    primaryContactId: string | null;
    outboundBlocked: boolean;
  };
}

const storedResultSchema = z.object({
  kind: z.literal("enrich_contact"),
  output: z.object({
    outcome: z.enum(["selected", "needs_review", "no_email"]),
    contactIds: z.array(z.string().uuid()).max(50),
    primaryContactId: z.string().uuid().nullable(),
    outboundBlocked: z.boolean(),
  }).strict(),
}).strict();

function stableUuid(parts: unknown[]): string {
  const digest = createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  const bytes = digest.slice(0, 32).split("");
  bytes[12] = "5";
  bytes[16] = ((Number.parseInt(bytes[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = bytes.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function normalizedUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.searchParams.sort();
  return url.toString();
}

function registrableDomain(value: string | null): string | null {
  if (!value) return null;
  try {
    const hostname = value.includes("://") ? new URL(value).hostname : value;
    return getDomain(hostname.toLowerCase().replace(/\.$/u, ""), {
      allowPrivateDomains: true,
    });
  } catch {
    return null;
  }
}

function activeLease(job: JobRow, input: PersistContactEnrichmentInput): boolean {
  if (
    Number.isNaN(input.now.getTime())
    || job.state !== "leased"
    || job.leaseOwner !== "worker-api"
    || job.leaseExpiresAt === null
  ) return false;
  try {
    return databaseDate(job.leaseExpiresAt).getTime() > input.now.getTime();
  } catch {
    return false;
  }
}

async function recordActivity(
  transaction: LeadHunterContactTransaction,
  input: {
    id: string;
    ownerId: string;
    campaignId: string;
    leadId: string;
    eventType: string;
    detail: Record<string, unknown>;
  },
) {
  await transaction.execute(sql`
    insert into ${leadHunterActivities} (
      id, owner_id, campaign_id, lead_id, actor_type, event_type, detail
    ) values (
      ${input.id}, ${input.ownerId}, ${input.campaignId}, ${input.leadId},
      'agent', ${input.eventType}, ${JSON.stringify(input.detail)}::jsonb
    )
    on conflict (id) do nothing
  `);
}

async function rejectOutput(
  transaction: LeadHunterContactTransaction,
  input: PersistContactEnrichmentInput,
  job: JobRow & { runId: string; leadId: string },
  campaignId: string,
  rejectionCode: string,
): Promise<PersistContactEnrichmentResult> {
  await recordActivity(transaction, {
    id: stableUuid([input.ownerId, input.jobId, "contact_enrichment", "rejected"]),
    ownerId: input.ownerId,
    campaignId,
    leadId: job.leadId,
    eventType: "contact_enrichment.rejected",
    detail: { jobId: input.jobId, rejectionCode },
  });
  await transaction.execute(sql`
    update ${leadHunterJobs}
    set
      state = 'failed',
      result = null,
      lease_owner = null,
      lease_token_digest = null,
      lease_expires_at = null,
      last_error = 'enrich_contact_output_rejected'
    where ${leadHunterJobs.ownerId} = ${input.ownerId}
      and ${leadHunterJobs.id} = ${input.jobId}
      and ${leadHunterJobs.state} = 'leased'
  `);
  await settleLeadHunterRun(transaction, job.runId, input.now);
  return {
    status: "rejected",
    outcome: null,
    contactIds: [],
    primaryContactId: null,
    outboundBlocked: false,
  };
}

async function lockJob(
  transaction: LeadHunterContactTransaction,
  input: PersistContactEnrichmentInput,
): Promise<JobRow> {
  const rows = await transaction.execute(sql<JobRow>`
    select
      job.id,
      job.run_id as "runId",
      job.enrollment_id as "enrollmentId",
      job.lead_id as "leadId",
      job.state,
      job.kind,
      job.payload,
      job.result,
      job.lease_token_digest as "leaseTokenDigest",
      job.lease_expires_at as "leaseExpiresAt",
      job.lease_owner as "leaseOwner"
    from ${leadHunterJobs} as job
    where job.owner_id = ${input.ownerId}
      and job.id = ${input.jobId}
    for update of job
  `) as unknown as JobRow[];
  const job = rows[0];
  const suppliedDigest = digestLeaseToken(input.leaseToken);
  if (!job || !exactDigestMatch(job.leaseTokenDigest, suppliedDigest)) {
    throw new JobCompletionRejectedError();
  }
  if (job.kind !== "enrich_contact") throw new Error("Job is not a contact enrichment job");
  if (job.state !== "succeeded" && !activeLease(job, input)) {
    throw new JobCompletionRejectedError();
  }
  return job;
}

function resultFromStored(result: unknown): PersistContactEnrichmentResult {
  const parsed = storedResultSchema.safeParse(result);
  if (!parsed.success) throw new Error("Stored contact enrichment result is invalid");
  return {
    status: "already_processed",
    ...parsed.data.output,
  };
}

function candidateMatchesSource(
  candidate: CandidateRow | undefined,
  source: z.infer<typeof contactEnrichmentPayloadSchema>["sources"][number],
  leadId: string,
): boolean {
  if (!candidate || !source.sourceCandidateId) return false;
  return candidate.id === source.sourceCandidateId
    && candidate.leadId === leadId
    && ["resolved", "duplicate"].includes(candidate.resolutionState)
    && candidate.sourceType === source.sourceType
    && candidate.canonicalUrl !== null
    && normalizedUrl(candidate.canonicalUrl) === normalizedUrl(source.sourceUrl);
}

function existingContactHasExactProvenance(
  existing: ExistingContactRow,
  contact: SelectedContact,
): boolean {
  if (
    existing.email !== contact.displayEmail
    || existing.normalizedEmail !== contact.normalizedEmail
    || existing.sourceUrl !== contact.sourceUrl
    || existing.sourceType !== contact.sourceType
    || existing.emailConfidence !== contact.confidenceScore
    || existing.verifiedAt === null
  ) return false;
  try {
    return databaseDate(existing.verifiedAt).toISOString() === contact.verifiedAt;
  } catch {
    return false;
  }
}

function existingContactWasRepublished(existing: ExistingContactRow, contact: SelectedContact, officialDomain: string | null): boolean {
  if (!officialDomain || !existing.verifiedAt || existing.normalizedEmail !== contact.normalizedEmail
      || registrableDomain(contact.sourceUrl) !== officialDomain
      || registrableDomain(existing.sourceUrl) !== officialDomain || contact.confidenceScore < 75) return false;
  for (const key of ["firstName", "lastName"] as const) {
    const before = existing[key]?.trim().toLocaleLowerCase();
    const after = contact[key]?.trim().toLocaleLowerCase();
    if (before && after && before !== after) return false;
  }
  try { return databaseDate(existing.verifiedAt).getTime() <= new Date(contact.verifiedAt).getTime(); }
  catch { return false; }
}

function persistenceCandidates(selection: ContactSelection): SelectedContact[] {
  if (selection.outcome === "no_email") return [];
  if (selection.reasons.some((reason) => [
    "cross_lead_email_collision",
    "conflicting_contact_identity",
    "conflicting_person_addresses",
  ].includes(reason))) return [];
  const contacts = selection.chosen
    ? [selection.chosen, ...selection.alternates]
    : selection.alternates;
  return contacts.slice(0, 50);
}

export async function persistContactEnrichmentResult(
  database: LeadHunterContactDatabase,
  input: PersistContactEnrichmentInput,
): Promise<PersistContactEnrichmentResult> {
  return database.transaction((transaction) =>
    persistContactEnrichmentResultInTransaction(transaction, input));
}

export async function persistContactEnrichmentResultInTransaction(
  transaction: LeadHunterContactTransaction,
  input: PersistContactEnrichmentInput,
): Promise<PersistContactEnrichmentResult> {
  const job = await lockJob(transaction, input);
  if (job.state === "succeeded") return resultFromStored(job.result);
  if (!job.leadId || !job.enrollmentId) {
    throw new Error("Contact enrichment job provenance is invalid");
  }
  const trustedJob = { ...job, leadId: job.leadId, enrollmentId: job.enrollmentId };

  // Global state lock order: job -> lead -> outbound advisory lock -> protection
  // -> enrollment -> campaign/version -> source candidates -> contacts -> run.
  const leadRows = await transaction.execute(sql<LeadRow>`
    select lead.status, lead.domain, lead.website
    from ${leadHunterLeads} as lead
    where lead.owner_id = ${input.ownerId}
      and lead.id = ${trustedJob.leadId}
    for update of lead
  `) as unknown as LeadRow[];
  const lead = leadRows[0];
  if (!lead) throw new Error("Contact enrichment lead provenance is invalid");

  await acquireLeadOutboundTransitionLock(transaction, input.ownerId, trustedJob.leadId);
  const outboundProtection = await getLeadOutboundProtection(
    transaction,
    input.ownerId,
    trustedJob.leadId,
  );

  const enrollmentRows = await transaction.execute(sql<EnrollmentRow>`
    select
      enrollment.campaign_id as "campaignId",
      enrollment.campaign_version as "campaignVersion",
      enrollment.evaluation,
      enrollment.status as "enrollmentStatus"
    from ${leadHunterEnrollments} as enrollment
    inner join ${leadHunterRuns} as run
      on run.owner_id = enrollment.owner_id
     and run.id = ${trustedJob.runId}
     and run.campaign_id = enrollment.campaign_id
     and run.campaign_version = enrollment.campaign_version
    where enrollment.owner_id = ${input.ownerId}
      and enrollment.id = ${trustedJob.enrollmentId}
      and enrollment.lead_id = ${trustedJob.leadId}
    for update of enrollment
  `) as unknown as EnrollmentRow[];
  const enrollment = enrollmentRows[0];
  if (!enrollment) throw new Error("Contact enrichment enrollment provenance is invalid");

  const campaignRows = await transaction.execute(sql<CampaignRow>`
    select campaign.config_version as "currentCampaignVersion"
    from ${leadHunterCampaigns} as campaign
    inner join ${leadHunterCampaignVersions} as version
      on version.owner_id = campaign.owner_id
     and version.campaign_id = campaign.id
     and version.version = ${enrollment.campaignVersion}
    where campaign.owner_id = ${input.ownerId}
      and campaign.id = ${enrollment.campaignId}
    for update of campaign, version
  `) as unknown as CampaignRow[];
  const campaign = campaignRows[0];
  if (!campaign) throw new Error("Contact enrichment campaign provenance is invalid");

  const payload = contactEnrichmentPayloadSchema.safeParse(trustedJob.payload);
  const envelope = contactEnrichmentEnvelopeSchema.safeParse(input.output);
  if (
    !payload.success
    || payload.data.leadId !== trustedJob.leadId
    || campaign.currentCampaignVersion !== enrollment.campaignVersion
    || !envelope.success
  ) {
    return rejectOutput(
      transaction,
      input,
      trustedJob,
      enrollment.campaignId,
      !envelope.success ? "invalid_envelope" : "stale_or_invalid_provenance",
    );
  }

  const candidateIds = payload.data.sources
    .map(({ sourceCandidateId }) => sourceCandidateId)
    .filter((id): id is string => id !== undefined)
    .sort();
  const candidateRows = await transaction.execute(sql<CandidateRow>`
    select
      candidate.id,
      candidate.source_type as "sourceType",
      candidate.canonical_url as "canonicalUrl",
      candidate.resolution_state as "resolutionState",
      candidate.lead_id as "leadId"
    from ${leadHunterSourceCandidates} as candidate
    where candidate.owner_id = ${input.ownerId}
      and candidate.run_id = ${trustedJob.runId}
      and candidate.lead_id = ${trustedJob.leadId}
      and candidate.id in (
        select jsonb_array_elements_text(${JSON.stringify(candidateIds)}::jsonb)::uuid
      )
    order by candidate.id
    for update of candidate
  `) as unknown as CandidateRow[];
  const candidatesById = new Map(candidateRows.map((candidate) => [candidate.id, candidate]));
  const officialDomain = registrableDomain(lead.website) ?? registrableDomain(lead.domain);
  const trustedSources: TrustedContactSource[] = payload.data.sources.map((source) => {
    const sourceDomain = registrableDomain(source.sourceUrl);
    let authority: TrustedContactSource["authority"] = "unmatched";
    if (officialDomain !== null && sourceDomain === officialDomain) {
      authority = "official";
    } else if (candidateMatchesSource(
      source.sourceCandidateId ? candidatesById.get(source.sourceCandidateId) : undefined,
      source,
      trustedJob.leadId,
    )) {
      authority = "strong_resolved";
    }
    return { ...source, authority };
  });

  const normalizedObservedEmails = envelope.data.observations
    .map(({ email }) => normalizePublishedEmail(email))
    .filter((email): email is string => email !== null)
    .sort();
  const existingContacts = await transaction.execute(sql<ExistingContactRow>`
    select
      contact.id,
      contact.lead_id as "leadId",
      contact.email,
      contact.normalized_email as "normalizedEmail",
      contact.first_name as "firstName",
      contact.last_name as "lastName",
      contact.role,
      contact.source_url as "sourceUrl",
      contact.source_type as "sourceType",
      contact.email_confidence as "emailConfidence",
      contact.verified_at as "verifiedAt",
      contact.is_primary as "isPrimary"
    from ${leadHunterContacts} as contact
    where contact.owner_id = ${input.ownerId}
      and (
        contact.lead_id = ${trustedJob.leadId}
        or contact.normalized_email in (
          select jsonb_array_elements_text(
            ${JSON.stringify(normalizedObservedEmails)}::jsonb
          )
        )
      )
    order by contact.lead_id, contact.id
    for update of contact
  `) as unknown as ExistingContactRow[];
  const crossLeadEmails = existingContacts
    .filter(({ leadId }) => leadId !== trustedJob.leadId)
    .map(({ normalizedEmail }) => normalizedEmail)
    .filter((email): email is string => email !== null);
  let selection = deriveContactSelection({
    officialDomain,
    sources: trustedSources,
    observations: envelope.data.observations,
    crossLeadEmails,
  });

  const currentPrimary = existingContacts.find(({ leadId, isPrimary }) => (
    leadId === trustedJob.leadId && isPrimary
  ));
  if (
    selection.outcome === "selected"
    && selection.chosen
    && currentPrimary
    && currentPrimary.normalizedEmail !== selection.chosen.normalizedEmail
  ) {
    selection = {
      ...selection,
      outcome: "needs_review",
      chosen: null,
      alternates: [selection.chosen, ...selection.alternates],
      reasons: [...new Set([...selection.reasons, "existing_primary_conflict"])].sort(),
    };
  }

  const contactIds: string[] = [];
  const idByNormalizedEmail = new Map<string, string>();
  let reusedCount = 0;
  const republications: Array<{ contactId: string; sourceUrl: string; verifiedAt: string }> = [];
  for (const contact of persistenceCandidates(selection)) {
    const existing = existingContacts.find(({ leadId, normalizedEmail }) => (
      leadId === trustedJob.leadId && normalizedEmail === contact.normalizedEmail
    ));
    if (existing) {
      const exactProvenance = existingContactHasExactProvenance(existing, contact);
      if (exactProvenance || existingContactWasRepublished(existing, contact, officialDomain)) {
        contactIds.push(existing.id);
        idByNormalizedEmail.set(contact.normalizedEmail, existing.id);
        reusedCount += 1;
        if (!exactProvenance) republications.push({ contactId: existing.id, sourceUrl: contact.sourceUrl, verifiedAt: contact.verifiedAt });
      } else {
        selection = {
          ...selection,
          outcome: "needs_review",
          chosen: null,
          reasons: [...new Set([
            ...selection.reasons,
            "existing_contact_provenance_conflict",
          ])].sort(),
        };
      }
      continue;
    }
    const id = stableUuid([
      input.ownerId,
      trustedJob.leadId,
      contact.normalizedEmail,
      contact.sourceUrl,
      contact.verifiedAt,
    ]);
    const rows = await transaction.execute(sql<{ id: string }>`
      insert into ${leadHunterContacts} (
        id, owner_id, lead_id, first_name, last_name, role,
        email, normalized_email, source_url, source_type,
        email_confidence, verified_at, is_primary
      ) values (
        ${id}, ${input.ownerId}, ${trustedJob.leadId}, ${contact.firstName},
        ${contact.lastName}, ${contact.role}, ${contact.displayEmail},
        ${contact.normalizedEmail}, ${contact.sourceUrl}, ${contact.sourceType},
        ${contact.confidenceScore}, ${contact.verifiedAt}::timestamptz, false
      )
      on conflict (owner_id, normalized_email)
        where normalized_email is not null
      do nothing
      returning id
    `) as unknown as Array<{ id: string }>;
    const inserted = rows[0];
    if (inserted) {
      contactIds.push(inserted.id);
      idByNormalizedEmail.set(contact.normalizedEmail, inserted.id);
    }
  }
  contactIds.sort();

  let primaryContactId: string | null = null;
  if (selection.outcome === "selected" && selection.chosen) {
    primaryContactId = idByNormalizedEmail.get(selection.chosen.normalizedEmail) ?? null;
    if (!primaryContactId) {
      selection = {
        ...selection,
        outcome: "needs_review",
        chosen: null,
        reasons: [...new Set([...selection.reasons, "contact_insert_conflict"])].sort(),
      };
    }
  }
  if (primaryContactId) {
    await transaction.execute(sql`
      update ${leadHunterContacts}
      set is_primary = case when id = ${primaryContactId} then true else false end
      where ${leadHunterContacts.ownerId} = ${input.ownerId}
        and ${leadHunterContacts.leadId} = ${trustedJob.leadId}
    `);
  }

  if (!outboundProtection.blocked) {
    if (selection.outcome === "selected") {
      await transaction.execute(sql`
        update ${leadHunterEnrollments}
        set evaluation = case when evaluation = 'no_email' then 'eligible' else evaluation end
        where ${leadHunterEnrollments.ownerId} = ${input.ownerId}
          and ${leadHunterEnrollments.id} = ${trustedJob.enrollmentId}
          and ${leadHunterEnrollments.leadId} = ${trustedJob.leadId}
          and ${leadHunterEnrollments.campaignId} = ${enrollment.campaignId}
      `);
    } else {
      await transaction.execute(sql`
        update ${leadHunterEnrollments}
        set evaluation = ${selection.outcome === "no_email" ? "no_email" : "needs_review"},
            status = 'researching'
        where ${leadHunterEnrollments.ownerId} = ${input.ownerId}
          and ${leadHunterEnrollments.id} = ${trustedJob.enrollmentId}
          and ${leadHunterEnrollments.leadId} = ${trustedJob.leadId}
          and ${leadHunterEnrollments.campaignId} = ${enrollment.campaignId}
      `);
    }
  }

  const outcome = selection.outcome;
  const stored: StoredResult = {
    kind: "enrich_contact",
    output: {
      outcome,
      contactIds,
      primaryContactId,
      outboundBlocked: outboundProtection.blocked,
    },
  };
  await recordActivity(transaction, {
    id: stableUuid([input.ownerId, input.jobId, "contact_enrichment", outcome]),
    ownerId: input.ownerId,
    campaignId: enrollment.campaignId,
    leadId: trustedJob.leadId,
    eventType: reusedCount > 0 && reusedCount === contactIds.length
      ? "contact_enrichment.reused"
      : outcome === "needs_review"
        ? "contact_enrichment.review"
        : `contact_enrichment.${outcome}`,
    detail: {
      jobId: input.jobId,
      outcome,
      primaryContactId,
      contactIds,
      sourceRefs: [...new Set(trustedSources.map(({ ref }) => ref))].sort(),
      reasons: selection.reasons.slice(0, 25),
      rejectedCount: selection.rejectedCount,
      reusedCount,
      republications,
      outboundBlocked: outboundProtection.blocked,
      outboundBlockReason: outboundProtection.reason,
    },
  });
  await transaction.execute(sql`
    update ${leadHunterJobs}
    set
      state = 'succeeded',
      result = ${JSON.stringify(stored)}::jsonb,
      lease_owner = null,
      lease_expires_at = null,
      last_error = null
    where ${leadHunterJobs.ownerId} = ${input.ownerId}
      and ${leadHunterJobs.id} = ${input.jobId}
      and ${leadHunterJobs.state} = 'leased'
  `);
  await settleLeadHunterRun(transaction, trustedJob.runId, input.now);
  return {
    status: "processed",
    outcome,
    contactIds,
    primaryContactId,
    outboundBlocked: outboundProtection.blocked,
  };
}
