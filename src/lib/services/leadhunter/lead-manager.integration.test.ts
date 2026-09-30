// @vitest-environment node

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as databaseSchema from "@/db/schema";
import {
  leadHunterCampaigns,
  leadHunterEnrollments,
  leadHunterLeads,
} from "@/db/schema";
import {
  acquireLeadOutboundTransitionLock,
  getLeadOutboundProtection,
} from "./lead-manager";

const integrationDatabaseSkipReason =
  "LeadHunter outbound integration skipped: an explicit isolated TEST_DATABASE_URL is required.";

function canonicalPostgresTarget(url: URL): string | undefined {
  if (!["postgres:", "postgresql:"].includes(url.protocol)) return undefined;
  if (!url.hostname || url.pathname.length <= 1) return undefined;
  return `postgresql://${url.hostname.toLowerCase()}:${url.port || "5432"}${
    decodeURIComponent(url.pathname)
  }`;
}

function isolatedTestDatabaseUrl(): string | undefined {
  const value = process.env.TEST_DATABASE_URL;
  if (!value || process.env.LEADHUNTER_TEST_DATABASE_CONFIRM !== "leadhunter-test-only") {
    return undefined;
  }
  try {
    const testUrl = new URL(value);
    const testTarget = canonicalPostgresTarget(testUrl);
    const databaseName = decodeURIComponent(testUrl.pathname.slice(1)).toLowerCase();
    if (
      !testTarget
      || !/(^|[_-])test($|[_-])/.test(databaseName)
      || /(^|[_-])(main|prod|production|live)($|[_-])/.test(databaseName)
    ) {
      return undefined;
    }
    if (process.env.DATABASE_URL) {
      const applicationTarget = canonicalPostgresTarget(
        new URL(process.env.DATABASE_URL),
      );
      if (!applicationTarget || applicationTarget === testTarget) return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

const testDatabaseUrl = isolatedTestDatabaseUrl();
if (!testDatabaseUrl) process.stderr.write(`${integrationDatabaseSkipReason}\n`);
const describeDatabase = testDatabaseUrl ? describe : describe.skip;
const databaseClient = testDatabaseUrl
  ? postgres(testDatabaseUrl, { prepare: false, max: 4 })
  : undefined;
const database = databaseClient
  ? drizzle({ client: databaseClient, schema: databaseSchema })
  : undefined;

afterAll(async () => {
  await databaseClient?.end();
});

describeDatabase("LeadHunter outbound transition database integration", () => {
  it("allows only one concurrent transition to pass the protected state check", async () => {
    const ownerId = randomUUID();
    const campaignId = randomUUID();
    const leadId = randomUUID();
    const enrollmentId = randomUUID();
    await database!.execute(sql`insert into auth.users (id) values (${ownerId})`);
    await database!.insert(leadHunterCampaigns).values({
      id: campaignId,
      ownerId,
      name: "Outbound lock fixture",
      objective: "Exercise concurrent transitions",
      serviceFocus: "automation",
      countries: ["AR"],
      sources: ["web_search"],
      positiveCriteria: [],
      negativeCriteria: [],
      schedule: {
        searchDays: ["monday"],
        searchTime: "09:00",
        sendDays: ["tuesday"],
        sendStart: "10:00",
        sendEnd: "16:00",
        timezone: "America/Argentina/Buenos_Aires",
      },
      sequenceSteps: [{
        delayDays: 0,
        subjectInstruction: "Introduce",
        bodyInstruction: "Ask",
      }],
      dailyLeadLimit: 1,
      dailyEmailLimit: 1,
    });
    await database!.insert(leadHunterLeads).values({
      id: leadId,
      ownerId,
      name: "Concurrent transition fixture",
      normalizedName: "concurrent transition fixture",
      status: "new",
    });
    await database!.insert(leadHunterEnrollments).values({
      id: enrollmentId,
      ownerId,
      campaignId,
      leadId,
      campaignVersion: 1,
      evaluation: "pending",
      status: "researching",
    });

    let readyCount = 0;
    let releaseReady!: () => void;
    const bothReady = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    const transition = () => database!.transaction(async (transaction) => {
      readyCount += 1;
      if (readyCount === 2) releaseReady();
      await bothReady;
      await acquireLeadOutboundTransitionLock(transaction, ownerId, leadId);
      const protection = await getLeadOutboundProtection(transaction, ownerId, leadId);
      if (protection.blocked) return false;
      await transaction.execute(sql`
        update ${leadHunterEnrollments}
        set status = 'contacting'
        where ${leadHunterEnrollments.ownerId} = ${ownerId}
          and ${leadHunterEnrollments.id} = ${enrollmentId}
      `);
      return true;
    });

    try {
      const outcomes = await Promise.all([transition(), transition()]);
      expect(outcomes.filter(Boolean)).toHaveLength(1);
    } finally {
      await database!.execute(sql`
        delete from ${leadHunterCampaigns}
        where ${leadHunterCampaigns.ownerId} = ${ownerId}
          and ${leadHunterCampaigns.id} = ${campaignId}
      `);
      await database!.execute(sql`
        delete from ${leadHunterLeads}
        where ${leadHunterLeads.ownerId} = ${ownerId}
          and ${leadHunterLeads.id} = ${leadId}
      `);
      await database!.execute(sql`delete from auth.users where id = ${ownerId}`);
    }
  }, 30_000);

  it("makes a qualification protection re-read observe a concurrent outbound transition", async () => {
    const ownerId = randomUUID();
    const campaignId = randomUUID();
    const leadId = randomUUID();
    const enrollmentId = randomUUID();
    await database!.execute(sql`insert into auth.users (id) values (${ownerId})`);
    await database!.insert(leadHunterCampaigns).values({
      id: campaignId,
      ownerId,
      name: "Qualification lock fixture",
      objective: "Exercise qualification protection",
      serviceFocus: "automation",
      countries: ["AR"],
      sources: ["web_search"],
      positiveCriteria: [],
      negativeCriteria: [],
      schedule: {
        searchDays: ["monday"],
        searchTime: "09:00",
        sendDays: ["tuesday"],
        sendStart: "10:00",
        sendEnd: "16:00",
        timezone: "America/Argentina/Buenos_Aires",
      },
      sequenceSteps: [{
        delayDays: 0,
        subjectInstruction: "Introduce",
        bodyInstruction: "Ask",
      }],
      dailyLeadLimit: 1,
      dailyEmailLimit: 1,
    });
    await database!.insert(leadHunterLeads).values({
      id: leadId,
      ownerId,
      name: "Qualification protection fixture",
      normalizedName: "qualification protection fixture",
      status: "new",
    });
    await database!.insert(leadHunterEnrollments).values({
      id: enrollmentId,
      ownerId,
      campaignId,
      leadId,
      campaignVersion: 1,
      evaluation: "pending",
      status: "researching",
    });

    let releaseOutbound!: () => void;
    let signalOutboundLocked!: () => void;
    const outboundLocked = new Promise<void>((resolve) => {
      signalOutboundLocked = resolve;
    });
    const holdOutbound = new Promise<void>((resolve) => {
      releaseOutbound = resolve;
    });

    try {
      const outbound = database!.transaction(async (transaction) => {
        await acquireLeadOutboundTransitionLock(transaction, ownerId, leadId);
        await transaction.execute(sql`
          update ${leadHunterEnrollments}
          set status = 'contacting'
          where ${leadHunterEnrollments.ownerId} = ${ownerId}
            and ${leadHunterEnrollments.id} = ${enrollmentId}
        `);
        signalOutboundLocked();
        await holdOutbound;
      });
      await outboundLocked;

      const qualificationProtection = database!.transaction(async (transaction) => {
        await acquireLeadOutboundTransitionLock(transaction, ownerId, leadId);
        return getLeadOutboundProtection(transaction, ownerId, leadId);
      });
      releaseOutbound();

      await outbound;
      await expect(qualificationProtection).resolves.toEqual({
        blocked: true,
        reason: "previously_contacted",
      });
    } finally {
      releaseOutbound?.();
      await database!.execute(sql`
        delete from ${leadHunterCampaigns}
        where ${leadHunterCampaigns.ownerId} = ${ownerId}
          and ${leadHunterCampaigns.id} = ${campaignId}
      `);
      await database!.execute(sql`
        delete from ${leadHunterLeads}
        where ${leadHunterLeads.ownerId} = ${ownerId}
          and ${leadHunterLeads.id} = ${leadId}
      `);
      await database!.execute(sql`delete from auth.users where id = ${ownerId}`);
    }
  }, 30_000);
});
