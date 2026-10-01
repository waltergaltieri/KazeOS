import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";

import { withAuthenticatedDb } from "@/db";
import {
  leadHunterCampaigns,
  leadHunterCampaignVersions,
  leadHunterContacts,
  leadHunterEnrollments,
  leadHunterEvidence,
  leadHunterLeads,
  leadHunterMessageVersions,
  leadHunterOutbox,
  leadHunterRuns,
  leadHunterWebsiteAudits,
} from "@/db/schema";
import { requireUser } from "@/lib/auth/require-user";
import {
  campaignIdSchema,
  leadIdSchema,
} from "@/lib/validations/leadhunter";

export interface LeadHunterCampaignListItem {
  id: string;
  name: string;
  objective: string;
  serviceFocus: string;
  status: "draft" | "active" | "paused" | "archived";
  automationMode: "drafts" | "automatic";
  countries: string[];
  sources: string[];
  dailyLeadLimit: number;
  dailyEmailLimit: number;
  leadCount: number;
  readyCount: number;
  contactingCount: number;
  repliedCount: number;
  nextSearchAt: Date | null;
  updatedAt: Date;
}

const enrollmentCount = (status?: string) => sql<number>`(
  select count(*)::int
  from ${leadHunterEnrollments} enrollment
  where enrollment.owner_id = ${leadHunterCampaigns.ownerId}
    and enrollment.campaign_id = ${leadHunterCampaigns.id}
    ${status ? sql`and enrollment.status = ${status}` : sql``}
)`.mapWith(Number);

export async function getLeadHunterCampaigns(): Promise<LeadHunterCampaignListItem[]> {
  const user = await requireUser();

  return withAuthenticatedDb(user.id, (database) =>
    database
      .select({
        id: leadHunterCampaigns.id,
        name: leadHunterCampaigns.name,
        objective: leadHunterCampaigns.objective,
        serviceFocus: leadHunterCampaigns.serviceFocus,
        status: leadHunterCampaigns.status,
        automationMode: leadHunterCampaigns.automationMode,
        countries: leadHunterCampaigns.countries,
        sources: leadHunterCampaigns.sources,
        dailyLeadLimit: leadHunterCampaigns.dailyLeadLimit,
        dailyEmailLimit: leadHunterCampaigns.dailyEmailLimit,
        leadCount: enrollmentCount(),
        readyCount: enrollmentCount("ready"),
        contactingCount: enrollmentCount("contacting"),
        repliedCount: enrollmentCount("replied"),
        nextSearchAt: leadHunterCampaigns.nextSearchAt,
        updatedAt: leadHunterCampaigns.updatedAt,
      })
      .from(leadHunterCampaigns)
      .where(eq(leadHunterCampaigns.ownerId, user.id))
      .orderBy(desc(leadHunterCampaigns.updatedAt), desc(leadHunterCampaigns.id)),
  );
}

export async function getLeadHunterCampaignById(id: string) {
  const user = await requireUser();

  return withAuthenticatedDb(user.id, async (database) => {
    const [campaign] = await database
      .select()
      .from(leadHunterCampaigns)
      .where(
        and(
          eq(leadHunterCampaigns.ownerId, user.id),
          eq(leadHunterCampaigns.id, id),
        ),
      )
      .limit(1);

    return campaign ?? null;
  });
}

export async function getLeadHunterCampaignWorkspace(idInput: unknown) {
  const id = campaignIdSchema.parse(idInput);
  const user = await requireUser();

  return withAuthenticatedDb(user.id, async (database) => {
    const [campaign] = await database
      .select()
      .from(leadHunterCampaigns)
      .where(and(eq(leadHunterCampaigns.ownerId, user.id), eq(leadHunterCampaigns.id, id)))
      .limit(1);
    if (!campaign) return null;
    const [version] = await database.select({ snapshot: leadHunterCampaignVersions.snapshot })
      .from(leadHunterCampaignVersions)
      .where(and(eq(leadHunterCampaignVersions.ownerId, user.id), eq(leadHunterCampaignVersions.campaignId, id), eq(leadHunterCampaignVersions.version, campaign.configVersion)))
      .limit(1);

    const prospects = await database
      .select({
        id: leadHunterLeads.id,
        name: leadHunterLeads.name,
        countryCode: leadHunterLeads.countryCode,
        city: leadHunterLeads.city,
        website: leadHunterLeads.website,
        email: sql<string | null>`(
          select contact.email
          from ${leadHunterContacts} contact
          where contact.owner_id = ${leadHunterLeads.ownerId}
            and contact.lead_id = ${leadHunterLeads.id}
            and contact.email is not null
          order by contact.created_at, contact.id
          limit 1
        )`,
        evaluation: leadHunterEnrollments.evaluation,
        status: leadHunterEnrollments.status,
        score: leadHunterEnrollments.score,
        reason: leadHunterEnrollments.reason,
        nextActionAt: leadHunterEnrollments.nextActionAt,
      })
      .from(leadHunterEnrollments)
      .innerJoin(
        leadHunterLeads,
        and(
          eq(leadHunterLeads.ownerId, leadHunterEnrollments.ownerId),
          eq(leadHunterLeads.id, leadHunterEnrollments.leadId),
        ),
      )
      .where(
        and(
          eq(leadHunterEnrollments.ownerId, user.id),
          eq(leadHunterEnrollments.campaignId, id),
        ),
      )
      .orderBy(desc(leadHunterEnrollments.updatedAt), desc(leadHunterEnrollments.id));

    const runs = await database
      .select({ id: leadHunterRuns.id, state: leadHunterRuns.state, counts: leadHunterRuns.counts, scheduledFor: leadHunterRuns.scheduledFor, startedAt: leadHunterRuns.startedAt, finishedAt: leadHunterRuns.finishedAt })
      .from(leadHunterRuns)
      .where(and(eq(leadHunterRuns.ownerId, user.id), eq(leadHunterRuns.campaignId, id)))
      .orderBy(desc(leadHunterRuns.createdAt))
      .limit(5);
    return { campaign, strategy: version?.snapshot.strategy ?? null, prospects, runs };
  });
}

export async function getLeadHunterLeads() {
  const user = await requireUser();

  return withAuthenticatedDb(user.id, (database) =>
    database
      .select({
        id: leadHunterLeads.id,
        name: leadHunterLeads.name,
        countryCode: leadHunterLeads.countryCode,
        city: leadHunterLeads.city,
        website: leadHunterLeads.website,
        status: leadHunterLeads.status,
        updatedAt: leadHunterLeads.updatedAt,
      })
      .from(leadHunterLeads)
      .where(eq(leadHunterLeads.ownerId, user.id))
      .orderBy(desc(leadHunterLeads.updatedAt), desc(leadHunterLeads.id)),
  );
}

export async function getLeadHunterLeadById(idInput: unknown) {
  const id = leadIdSchema.parse(idInput);
  const user = await requireUser();

  return withAuthenticatedDb(user.id, async (database) => {
    const [lead] = await database
      .select()
      .from(leadHunterLeads)
      .where(and(eq(leadHunterLeads.ownerId, user.id), eq(leadHunterLeads.id, id)))
      .limit(1);
    if (!lead) return null;

    const [contacts, evidence, campaigns, audits, messages, outbox] = await Promise.all([
      database
        .select({
          id: leadHunterContacts.id,
          firstName: leadHunterContacts.firstName,
          lastName: leadHunterContacts.lastName,
          role: leadHunterContacts.role,
          email: leadHunterContacts.email,
          phone: leadHunterContacts.phone,
          sourceUrl: leadHunterContacts.sourceUrl,
          sourceType: leadHunterContacts.sourceType,
          emailConfidence: leadHunterContacts.emailConfidence,
          isPrimary: leadHunterContacts.isPrimary,
        })
        .from(leadHunterContacts)
        .where(and(eq(leadHunterContacts.ownerId, user.id), eq(leadHunterContacts.leadId, id)))
        .orderBy(leadHunterContacts.createdAt, leadHunterContacts.id),
      database
        .select({
          id: leadHunterEvidence.id,
          kind: leadHunterEvidence.kind,
          field: leadHunterEvidence.field,
          value: leadHunterEvidence.value,
          sourceType: leadHunterEvidence.sourceType,
          sourceUrl: leadHunterEvidence.sourceUrl,
          confidence: leadHunterEvidence.confidence,
          observedAt: leadHunterEvidence.observedAt,
        })
        .from(leadHunterEvidence)
        .where(and(eq(leadHunterEvidence.ownerId, user.id), eq(leadHunterEvidence.leadId, id)))
        .orderBy(desc(leadHunterEvidence.observedAt), desc(leadHunterEvidence.id)),
      database
        .select({
          campaignId: leadHunterCampaigns.id,
          campaignName: leadHunterCampaigns.name,
          evaluation: leadHunterEnrollments.evaluation,
          status: leadHunterEnrollments.status,
          score: leadHunterEnrollments.score,
        })
        .from(leadHunterEnrollments)
        .innerJoin(
          leadHunterCampaigns,
          and(
            eq(leadHunterCampaigns.ownerId, leadHunterEnrollments.ownerId),
            eq(leadHunterCampaigns.id, leadHunterEnrollments.campaignId),
          ),
        )
        .where(and(eq(leadHunterEnrollments.ownerId, user.id), eq(leadHunterEnrollments.leadId, id)))
        .orderBy(desc(leadHunterEnrollments.updatedAt)),
      database
        .select({ id: leadHunterWebsiteAudits.id, gateResult: leadHunterWebsiteAudits.gateResult, summary: leadHunterWebsiteAudits.summary, confidence: leadHunterWebsiteAudits.confidence, checks: leadHunterWebsiteAudits.checks, createdAt: leadHunterWebsiteAudits.createdAt })
        .from(leadHunterWebsiteAudits)
        .where(and(eq(leadHunterWebsiteAudits.ownerId, user.id), eq(leadHunterWebsiteAudits.leadId, id)))
        .orderBy(desc(leadHunterWebsiteAudits.createdAt)),
      database
        .select({ id: leadHunterMessageVersions.id, enrollmentId: leadHunterMessageVersions.enrollmentId, subject: leadHunterMessageVersions.subject, body: leadHunterMessageVersions.body, state: leadHunterMessageVersions.state, validationResult: leadHunterMessageVersions.validationResult, createdAt: leadHunterMessageVersions.createdAt })
        .from(leadHunterMessageVersions)
        .innerJoin(leadHunterEnrollments, and(eq(leadHunterEnrollments.ownerId, leadHunterMessageVersions.ownerId), eq(leadHunterEnrollments.id, leadHunterMessageVersions.enrollmentId)))
        .where(and(eq(leadHunterMessageVersions.ownerId, user.id), eq(leadHunterEnrollments.leadId, id)))
        .orderBy(desc(leadHunterMessageVersions.createdAt)),
      database
        .select({ id: leadHunterOutbox.id, enrollmentId: leadHunterOutbox.enrollmentId, messageVersionId: leadHunterOutbox.messageVersionId, logicalStep: leadHunterOutbox.logicalStep, dueAt: leadHunterOutbox.dueAt, state: leadHunterOutbox.state, subject: leadHunterOutbox.subject, providerMessageId: leadHunterOutbox.providerMessageId, lastError: leadHunterOutbox.lastError })
        .from(leadHunterOutbox)
        .innerJoin(leadHunterEnrollments, and(eq(leadHunterEnrollments.ownerId, leadHunterOutbox.ownerId), eq(leadHunterEnrollments.id, leadHunterOutbox.enrollmentId)))
        .where(and(eq(leadHunterOutbox.ownerId, user.id), eq(leadHunterEnrollments.leadId, id)))
        .orderBy(leadHunterOutbox.logicalStep),
    ]);

    return { lead, contacts, evidence, campaigns, audits, messages, outbox };
  });
}
