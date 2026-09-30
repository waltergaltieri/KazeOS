import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  leadHunterActivities,
  leadHunterCampaigns,
  leadHunterCampaignVersions,
} from "@/db/schema";
import {
  createCampaign,
  type LeadHunterDatabase,
} from "./campaign-manager";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const campaignId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const values = {
  name: "Mayoristas Argentina",
  objective: "Encontrar negocios con pedidos mayoristas todavía manuales.",
  serviceFocus: "custom_management" as const,
  countries: ["AR"],
  sources: ["web_search" as const],
  positiveCriteria: ["Catálogo mayorista"],
  negativeCriteria: ["Ya es cliente"],
  searchDays: ["monday" as const],
  searchTime: "09:00",
  sendDays: ["tuesday" as const],
  sendStart: "10:00",
  sendEnd: "16:00",
  timezone: "America/Argentina/Buenos_Aires",
  dailyLeadLimit: 30,
  dailyEmailLimit: 12,
  sequenceSteps: [
    {
      delayDays: 0,
      subjectInstruction: "Presentar la mejora",
      bodyInstruction: "Hacer una pregunta breve",
    },
  ],
};

describe("createCampaign", () => {
  it("persists a draft, its first immutable snapshot and an activity", async () => {
    const inserts: Array<{ table: unknown; value: Record<string, unknown> }> = [];
    const database = {
      insert: vi.fn((table: unknown) => ({
        values: (value: Record<string, unknown>) => {
          inserts.push({ table, value });
          if (table === leadHunterCampaigns) {
            return { returning: async () => [{ id: campaignId }] };
          }
          return Promise.resolve();
        },
      })),
    };

    const result = await createCampaign(
      database as unknown as LeadHunterDatabase,
      ownerId,
      values,
    );

    expect(result).toBe(campaignId);
    expect(inserts).toEqual([
      expect.objectContaining({
        table: leadHunterCampaigns,
        value: expect.objectContaining({
          ownerId,
          name: "Mayoristas Argentina",
          status: "draft",
          configVersion: 1,
        }),
      }),
      expect.objectContaining({
        table: leadHunterCampaignVersions,
        value: expect.objectContaining({ ownerId, campaignId, version: 1 }),
      }),
      expect.objectContaining({
        table: leadHunterActivities,
        value: expect.objectContaining({
          ownerId,
          campaignId,
          actorType: "human",
          eventType: "campaign.created",
        }),
      }),
    ]);
  });

  it("fails instead of leaving an incomplete campaign when insert returns no id", async () => {
    const database = {
      insert: vi.fn(() => ({
        values: () => ({ returning: async () => [] }),
      })),
    };

    await expect(createCampaign(
      database as unknown as LeadHunterDatabase,
      ownerId,
      values,
    )).rejects.toThrow(
      "Campaign insert did not return an id",
    );
  });
});
