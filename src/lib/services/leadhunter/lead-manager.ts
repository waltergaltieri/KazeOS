import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/db/schema";
import {
  leadHunterActivities,
  leadHunterCampaigns,
  leadHunterContacts,
  leadHunterEnrollments,
  leadHunterEvidence,
  leadHunterLeads,
  leadHunterOutbox,
} from "@/db/schema";
import type { LeadFormValues } from "@/lib/validations/leadhunter";

export type LeadHunterLeadDatabase = Pick<
  PostgresJsDatabase<typeof schema>,
  "select" | "insert"
>;

export type LeadHunterLeadProtectionDatabase = Pick<
  PostgresJsDatabase<typeof schema>,
  "execute"
>;

export type LeadOutboundProtection =
  | { blocked: false; reason: null }
  | {
    blocked: true;
    reason: "previously_contacted" | "active_outbound";
  };

interface LeadOutboundProtectionRow {
  contacted: boolean;
  activeOutbound: boolean;
}

export async function getLeadOutboundProtection(
  database: LeadHunterLeadProtectionDatabase,
  ownerId: string,
  leadId: string,
): Promise<LeadOutboundProtection> {
  const rows = await database.execute(sql<LeadOutboundProtectionRow>`
    with target as (
      select ${ownerId}::uuid as owner_id, ${leadId}::uuid as lead_id
    )
    select
      exists (
        select 1
        from ${leadHunterEnrollments}, target
        where ${leadHunterEnrollments.ownerId} = target.owner_id
          and ${leadHunterEnrollments.leadId} = target.lead_id
          and (
            ${leadHunterEnrollments.status} in ('contacting', 'replied', 'completed')
            or exists (
              select 1
              from ${leadHunterOutbox}
              where ${leadHunterOutbox.ownerId} = target.owner_id
                and ${leadHunterOutbox.enrollmentId} = ${leadHunterEnrollments.id}
                and ${leadHunterOutbox.state} in ('provider_accepted', 'unknown')
            )
          )
      ) as contacted,
      exists (
        select 1
        from target
        inner join ${leadHunterEnrollments}
          on ${leadHunterEnrollments.ownerId} = target.owner_id
         and ${leadHunterEnrollments.leadId} = target.lead_id
        inner join ${leadHunterOutbox}
          on ${leadHunterOutbox.ownerId} = target.owner_id
         and ${leadHunterOutbox.enrollmentId} = ${leadHunterEnrollments.id}
        where ${leadHunterOutbox.state} in ('queued', 'leased')
      ) as "activeOutbound"
  `) as unknown as LeadOutboundProtectionRow[];
  const protection = rows[0];
  if (!protection) throw new Error("Lead outbound protection could not be determined");
  if (protection.contacted) {
    return { blocked: true, reason: "previously_contacted" };
  }
  if (protection.activeOutbound) {
    return { blocked: true, reason: "active_outbound" };
  }
  return { blocked: false, reason: null };
}

export function normalizeBusinessName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function domainFromWebsite(website: string | null): string | null {
  if (!website) return null;
  return new URL(website).hostname.toLowerCase().replace(/^www\./, "");
}

function hasContact(values: LeadFormValues): boolean {
  return Boolean(
    values.firstName ||
      values.lastName ||
      values.role ||
      values.email ||
      values.phone,
  );
}

export async function createLead(
  database: LeadHunterLeadDatabase,
  ownerId: string,
  values: LeadFormValues,
): Promise<string> {
  const [campaign] = await database
    .select({ configVersion: leadHunterCampaigns.configVersion })
    .from(leadHunterCampaigns)
    .where(
      and(
        eq(leadHunterCampaigns.ownerId, ownerId),
        eq(leadHunterCampaigns.id, values.campaignId),
      ),
    )
    .limit(1);

  if (!campaign) throw new Error("Campaign not found");

  const [lead] = await database
    .insert(leadHunterLeads)
    .values({
      ownerId,
      name: values.name,
      normalizedName: normalizeBusinessName(values.name),
      domain: domainFromWebsite(values.website),
      website: values.website,
      countryCode: values.countryCode,
      city: values.city,
      description: values.description,
      status: "new",
    })
    .returning({ id: leadHunterLeads.id });

  if (!lead) throw new Error("Lead insert did not return an id");

  if (hasContact(values)) {
    await database.insert(leadHunterContacts).values({
      ownerId,
      leadId: lead.id,
      firstName: values.firstName,
      lastName: values.lastName,
      role: values.role,
      email: values.email,
      normalizedEmail: values.email,
      phone: values.phone,
      sourceUrl: values.sourceUrl,
    });
  }

  await database.insert(leadHunterEvidence).values({
    ownerId,
    leadId: lead.id,
    kind: "fact",
    sourceType: values.sourceType,
    sourceUrl: values.sourceUrl,
    field: "business.identity",
    value: values.name,
    confidence: values.sourceType === "manual" ? 100 : 80,
  });

  await database.insert(leadHunterEnrollments).values({
    ownerId,
    campaignId: values.campaignId,
    leadId: lead.id,
    campaignVersion: campaign.configVersion,
    evaluation: values.email ? "pending" : "no_email",
    status: "researching",
  });

  await database.insert(leadHunterActivities).values({
    ownerId,
    campaignId: values.campaignId,
    leadId: lead.id,
    actorType: "human",
    eventType: "lead.created",
    detail: { sourceType: values.sourceType },
  });

  return lead.id;
}
