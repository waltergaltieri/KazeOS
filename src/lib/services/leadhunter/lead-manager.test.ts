import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  leadHunterActivities,
  leadHunterContacts,
  leadHunterEnrollments,
  leadHunterEvidence,
  leadHunterLeads,
} from "@/db/schema";
import {
  acquireLeadOutboundTransitionLock,
  createLead,
  getLeadOutboundProtection,
  leadOutboundTransitionLockKey,
  type LeadHunterLeadDatabase,
  type LeadHunterLeadProtectionDatabase,
} from "./lead-manager";

const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const campaignId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const leadId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const dialect = new PgDialect();

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

describe("getLeadOutboundProtection", () => {
  it("blocks a lead that has already reached a contacted state", async () => {
    const execute = vi.fn(async (query: unknown) => {
      const rendered = dialect.sqlToQuery(
        query as Parameters<PgDialect["sqlToQuery"]>[0],
      );
      expect(rendered.sql).toContain("select $1::uuid as owner_id, $2::uuid as lead_id");
      expect(rendered.sql).toContain(
        '"lh_enrollments"."owner_id" = target.owner_id',
      );
      expect(rendered.sql).toContain(
        '"lh_enrollments"."lead_id" = target.lead_id',
      );
      expect(rendered.sql).toContain('"lh_leads"."status" = \'converted\'');
      expect(rendered.sql).toContain('"lh_leads"."linked_client_id" is not null');
      expect(rendered.sql).toContain(
        '"lh_leads"."status" in (\'excluded\', \'archived\')',
      );
      expect(rendered.sql).toContain('"lh_enrollments"."evaluation" = \'excluded\'');
      expect(rendered.sql).toContain('"lh_enrollments"."status" = \'stopped\'');
      expect(rendered.params).toEqual([ownerId, leadId]);
      return [{ contacted: true, activeOutbound: false }];
    });

    await expect(getLeadOutboundProtection(
      { execute } as unknown as LeadHunterLeadProtectionDatabase,
      ownerId,
      leadId,
    )).resolves.toEqual({
      blocked: true,
      reason: "previously_contacted",
    });
  });

  it("blocks duplicate outbound while another command is queued or leased", async () => {
    const execute = vi.fn(async () => [{
      contacted: false,
      activeOutbound: true,
    }]);

    await expect(getLeadOutboundProtection(
      { execute } as unknown as LeadHunterLeadProtectionDatabase,
      ownerId,
      leadId,
    )).resolves.toEqual({
      blocked: true,
      reason: "active_outbound",
    });
  });

  it("allows a lead with no prior contact or active outbound", async () => {
    const execute = vi.fn(async () => [{
      contacted: false,
      activeOutbound: false,
    }]);

    await expect(getLeadOutboundProtection(
      { execute } as unknown as LeadHunterLeadProtectionDatabase,
      ownerId,
      leadId,
    )).resolves.toEqual({ blocked: false, reason: null });
  });

  it.each([
    {
      row: {
        convertedOrClient: true,
        suppressed: false,
        contacted: false,
        activeOutbound: false,
      },
      reason: "converted_or_client",
    },
    {
      row: {
        convertedOrClient: false,
        suppressed: true,
        contacted: false,
        activeOutbound: false,
      },
      reason: "suppressed",
    },
  ])("blocks durable lead protection: $reason", async ({ row, reason }) => {
    const execute = vi.fn(async () => [row]);

    await expect(getLeadOutboundProtection(
      { execute } as unknown as LeadHunterLeadProtectionDatabase,
      ownerId,
      leadId,
    )).resolves.toEqual({ blocked: true, reason });
  });
});

describe("lead outbound transition serialization", () => {
  it("uses one deterministic transaction-scoped lock for an owner and lead", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const execute = vi.fn(async (query: unknown) => {
      statements.push(dialect.sqlToQuery(
        query as Parameters<PgDialect["sqlToQuery"]>[0],
      ));
      return [];
    });

    expect(leadOutboundTransitionLockKey(ownerId, leadId)).toBe(
      `leadhunter:outbound:${ownerId}:${leadId}`,
    );
    await acquireLeadOutboundTransitionLock(
      { execute } as unknown as LeadHunterLeadProtectionDatabase,
      ownerId,
      leadId,
    );

    expect(statements).toEqual([expect.objectContaining({
      sql: expect.stringContaining("pg_advisory_xact_lock(hashtextextended("),
      params: [`leadhunter:outbound:${ownerId}:${leadId}`],
    })]);
  });
});
