import "server-only";

import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/db/schema";
import {
  leadHunterActivities,
  leadHunterCampaigns,
  leadHunterCampaignVersions,
  type LeadHunterCampaignSnapshot,
} from "@/db/schema";
import { createDefaultCampaignStrategy } from "@/lib/leadhunter/contracts";
import type { CampaignFormValues } from "@/lib/validations/leadhunter";

export type LeadHunterDatabase = Pick<PostgresJsDatabase<typeof schema>, "insert">;

function snapshotFromValues(values: CampaignFormValues): LeadHunterCampaignSnapshot {
  return {
    objective: values.objective,
    serviceFocus: values.serviceFocus,
    countries: values.countries,
    sources: values.sources,
    positiveCriteria: values.positiveCriteria,
    negativeCriteria: values.negativeCriteria,
    strategy: values.strategy ?? createDefaultCampaignStrategy(values),
    schedule: {
      searchDays: values.searchDays,
      searchTime: values.searchTime,
      sendDays: values.sendDays,
      sendStart: values.sendStart,
      sendEnd: values.sendEnd,
      timezone: values.timezone,
    },
    dailyLeadLimit: values.dailyLeadLimit,
    dailyEmailLimit: values.dailyEmailLimit,
    sequenceSteps: values.sequenceSteps,
  };
}

export async function createCampaign(
  database: LeadHunterDatabase,
  ownerId: string,
  values: CampaignFormValues,
): Promise<string> {
  const schedule = {
    searchDays: values.searchDays,
    searchTime: values.searchTime,
    sendDays: values.sendDays,
    sendStart: values.sendStart,
    sendEnd: values.sendEnd,
    timezone: values.timezone,
  };

  const [created] = await database
    .insert(leadHunterCampaigns)
    .values({
      ownerId,
      name: values.name,
      objective: values.objective,
      serviceFocus: values.serviceFocus,
      status: "draft",
      automationMode: "drafts",
      countries: values.countries,
      sources: values.sources,
      positiveCriteria: values.positiveCriteria,
      negativeCriteria: values.negativeCriteria,
      schedule,
      sequenceSteps: values.sequenceSteps,
      dailyLeadLimit: values.dailyLeadLimit,
      dailyEmailLimit: values.dailyEmailLimit,
      configVersion: 1,
    })
    .returning({ id: leadHunterCampaigns.id });

  if (!created) {
    throw new Error("Campaign insert did not return an id");
  }

  await database.insert(leadHunterCampaignVersions).values({
    ownerId,
    campaignId: created.id,
    version: 1,
    snapshot: snapshotFromValues(values),
  });

  await database.insert(leadHunterActivities).values({
    ownerId,
    campaignId: created.id,
    actorType: "human",
    eventType: "campaign.created",
    detail: { version: 1 },
  });

  return created.id;
}
