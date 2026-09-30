import "server-only";

import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/db/schema";
import {
  leadHunterActivities,
  leadHunterCampaigns,
  leadHunterContacts,
  leadHunterEnrollments,
  leadHunterEvidence,
  leadHunterLeads,
} from "@/db/schema";
import type { LeadFormValues } from "@/lib/validations/leadhunter";

export type LeadHunterLeadDatabase = Pick<
  PostgresJsDatabase<typeof schema>,
  "select" | "insert"
>;

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
