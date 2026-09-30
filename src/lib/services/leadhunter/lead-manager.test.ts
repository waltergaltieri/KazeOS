import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  leadHunterActivities,
  leadHunterContacts,
  leadHunterEnrollments,
  leadHunterEvidence,
  leadHunterLeads,
} from "@/db/schema";
import { createLead, type LeadHunterLeadDatabase } from "./lead-manager";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const campaignId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const leadId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const input = {
  campaignId,
  name: "Distribuidora Águila",
  countryCode: "AR",
  city: "Rosario",
  website: null,
  description: "Pedidos por teléfono",
  firstName: "Ana",
  lastName: "Pérez",
  role: "Ventas",
  email: "ana@example.com",
  phone: null,
  sourceType: "manual" as const,
  sourceUrl: null,
};

function databaseWithCampaign() {
  const inserts: Array<{ table: unknown; value: Record<string, unknown> }> = [];
  const database = {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({ limit: async () => [{ configVersion: 2 }] }),
      }),
    })),
    insert: vi.fn((table: unknown) => ({
      values: (value: Record<string, unknown>) => {
        inserts.push({ table, value });
        if (table === leadHunterLeads) {
          return { returning: async () => [{ id: leadId }] };
        }
        return Promise.resolve();
      },
    })),
  };
  return { database, inserts };
}

describe("createLead", () => {
  it("creates the prospect, contact, evidence, enrollment and activity", async () => {
    const { database, inserts } = databaseWithCampaign();

    const result = await createLead(
      database as unknown as LeadHunterLeadDatabase,
      ownerId,
      input,
    );

    expect(result).toBe(leadId);
    expect(inserts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: leadHunterLeads,
        value: expect.objectContaining({
          ownerId,
          name: "Distribuidora Águila",
          normalizedName: "distribuidora aguila",
        }),
      }),
      expect.objectContaining({
        table: leadHunterContacts,
        value: expect.objectContaining({
          email: "ana@example.com",
          normalizedEmail: "ana@example.com",
        }),
      }),
      expect.objectContaining({ table: leadHunterEvidence }),
      expect.objectContaining({
        table: leadHunterEnrollments,
        value: expect.objectContaining({ campaignVersion: 2 }),
      }),
      expect.objectContaining({
        table: leadHunterActivities,
        value: expect.objectContaining({ eventType: "lead.created" }),
      }),
    ]));
  });

  it("rejects an unknown or foreign campaign before creating a lead", async () => {
    const { database, inserts } = databaseWithCampaign();
    database.select.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    });

    await expect(createLead(
      database as unknown as LeadHunterLeadDatabase,
      ownerId,
      input,
    )).rejects.toThrow("Campaign not found");
    expect(inserts).toHaveLength(0);
  });
});
