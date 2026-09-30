// @vitest-environment node

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import * as databaseSchema from "@/db/schema";
import {
  leadHunterActivities,
  leadHunterCampaigns,
  leadHunterCampaignVersions,
  leadHunterEnrollments,
  leadHunterEvidence,
  leadHunterJobs,
  leadHunterLeads,
  leadHunterRuns,
  leadHunterWebsiteAudits,
  type LeadHunterCampaignSnapshot,
} from "@/db/schema";
import { createDefaultCampaignStrategy } from "@/lib/leadhunter/contracts";
import { digestLeaseToken } from "./job-manager";
import { persistWebsiteAuditResult } from "./qualification-manager";

const integrationDatabaseSkipReason =
  "LeadHunter qualification integration skipped: an explicit isolated TEST_DATABASE_URL is required.";

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
    ) return undefined;
    if (process.env.DATABASE_URL) {
      const applicationTarget = canonicalPostgresTarget(new URL(process.env.DATABASE_URL));
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

describeDatabase("LeadHunter qualification database integration", () => {
  it("serializes concurrent audit jobs and reuses one canonical audit", async () => {
    const ownerId = randomUUID();
    const campaignId = randomUUID();
    const runId = randomUUID();
    const leadId = randomUUID();
    const enrollmentId = randomUUID();
    const firstJobId = randomUUID();
    const secondJobId = randomUUID();
    const firstLeaseToken = "qualification-integration-first-lease";
    const secondLeaseToken = "qualification-integration-second-lease";
    const completionTime = new Date("2026-09-30T12:01:00.000Z");
    const observedAt = "2026-09-30T12:00:00.000Z";
    const leaseExpiresAt = new Date("2026-09-30T12:05:00.000Z");
    const schedule = {
      searchDays: ["monday"], searchTime: "09:00",
      sendDays: ["tuesday"], sendStart: "10:00", sendEnd: "16:00",
      timezone: "America/Argentina/Buenos_Aires",
    };
    const sequenceSteps = [{
      delayDays: 0, subjectInstruction: "Introduce", bodyInstruction: "Ask",
    }];
    const strategy = createDefaultCampaignStrategy({
      objective: "Exercise concurrent website audits",
      serviceFocus: "automation",
      countries: ["AR"],
      sources: ["web_search"],
      positiveCriteria: [],
      negativeCriteria: [],
    });
    const snapshot: LeadHunterCampaignSnapshot = {
      objective: "Exercise concurrent website audits",
      serviceFocus: "automation",
      countries: ["AR"],
      sources: ["web_search"],
      positiveCriteria: [],
      negativeCriteria: [],
      strategy,
      schedule,
      dailyLeadLimit: 10,
      dailyEmailLimit: 10,
      sequenceSteps,
    };

    await database!.execute(sql`insert into auth.users (id) values (${ownerId})`);
    await database!.insert(leadHunterCampaigns).values({
      id: campaignId, ownerId, name: "Concurrent audit fixture",
      objective: snapshot.objective, serviceFocus: snapshot.serviceFocus,
      status: "active", countries: snapshot.countries, sources: snapshot.sources,
      positiveCriteria: [], negativeCriteria: [], schedule, sequenceSteps,
      dailyLeadLimit: 10, dailyEmailLimit: 10, configVersion: 1,
    });
    await database!.insert(leadHunterCampaignVersions).values({
      ownerId, campaignId, version: 1, snapshot,
    });
    await database!.insert(leadHunterRuns).values({
      id: runId, ownerId, campaignId, campaignVersion: 1,
      scheduledFor: completionTime, plan: {}, state: "running",
    });
    await database!.insert(leadHunterLeads).values({
      id: leadId, ownerId, name: "Concurrent audit lead",
      normalizedName: "concurrent audit lead", status: "researching",
    });
    await database!.insert(leadHunterEnrollments).values({
      id: enrollmentId, ownerId, campaignId, leadId,
      campaignVersion: 1, evaluation: "pending", status: "researching",
    });
    await database!.insert(leadHunterJobs).values([
      {
        id: firstJobId, ownerId, runId, enrollmentId, leadId,
        kind: "audit_website", state: "leased",
        payload: { leadId, website: "https://example.com" }, attemptCount: 1,
        leaseOwner: "worker-api", leaseTokenDigest: digestLeaseToken(firstLeaseToken),
        leaseExpiresAt, idempotencyKey: `${runId}:audit:first`,
      },
      {
        id: secondJobId, ownerId, runId, enrollmentId, leadId,
        kind: "audit_website", state: "leased",
        payload: { leadId, website: "https://example.com" }, attemptCount: 1,
        leaseOwner: "worker-api", leaseTokenDigest: digestLeaseToken(secondLeaseToken),
        leaseExpiresAt, idempotencyKey: `${runId}:audit:second`,
      },
    ]);

    const alternateBadWebsite = { observations: [
      {
        type: "secure_transport", state: "invalid", observedAt,
        source: { sourceType: "tls_probe", sourceUrl: "https://example.com" },
      },
      {
        type: "navigation", testedPaths: 5, brokenPaths: 3, observedAt,
        source: { sourceType: "website_scan", sourceUrl: "https://example.com/scan" },
      },
    ] };
    const badWebsite = { observations: [
      {
        type: "page_integrity", checkedPages: 5, brokenPages: 3, observedAt,
        source: { sourceType: "website_scan", sourceUrl: "https://example.com/scan" },
      },
      {
        type: "critical_content", requiredItems: ["services", "contact"],
        missingItems: ["contact"], observedAt,
        source: { sourceType: "official_site", sourceUrl: "https://example.com" },
      },
    ] };

    try {
      const results = await Promise.all([
        persistWebsiteAuditResult(database!, {
          ownerId, jobId: firstJobId, leaseToken: firstLeaseToken,
          now: completionTime, output: alternateBadWebsite,
        }),
        persistWebsiteAuditResult(database!, {
          ownerId, jobId: secondJobId, leaseToken: secondLeaseToken,
          now: completionTime, output: badWebsite,
        }),
      ]);

      expect(results.map(({ status }) => status)).toEqual(["processed", "processed"]);
      expect(new Set(results.map(({ auditId }) => auditId))).toHaveLength(1);
      expect(new Set(results.map(({ gateResult }) => gateResult))).toHaveLength(1);

      const audits = await database!.select().from(leadHunterWebsiteAudits)
        .where(sql`${leadHunterWebsiteAudits.ownerId} = ${ownerId}`);
      const evidence = await database!.select({ field: leadHunterEvidence.field })
        .from(leadHunterEvidence)
        .where(sql`${leadHunterEvidence.ownerId} = ${ownerId}`);
      const jobs = await database!.select({ state: leadHunterJobs.state })
        .from(leadHunterJobs)
        .where(sql`${leadHunterJobs.ownerId} = ${ownerId}`);
      const activities = await database!.select({
        eventType: leadHunterActivities.eventType,
        detail: leadHunterActivities.detail,
      }).from(leadHunterActivities)
        .where(sql`${leadHunterActivities.ownerId} = ${ownerId}`);

      expect(audits).toHaveLength(1);
      expect(evidence).toHaveLength(2);
      expect([
        ["website_navigation", "website_secure_transport"],
        ["website_critical_content", "website_page_integrity"],
      ]).toContainEqual(evidence.map(({ field }) => field).sort());
      expect(jobs).toEqual([{ state: "succeeded" }, { state: "succeeded" }]);
      expect(activities.map(({ eventType }) => eventType).sort()).toEqual([
        "audit_website.completed",
        "website_audit.reused",
      ]);
      expect(activities.every(({ detail }) => (
        detail.auditId === audits[0]!.id
        && detail.gateResult === audits[0]!.gateResult
      ))).toBe(true);
    } finally {
      await database!.execute(sql`
        delete from ${leadHunterCampaigns}
        where ${leadHunterCampaigns.ownerId} = ${ownerId}
          and ${leadHunterCampaigns.id} = ${campaignId}
      `);
      await database!.execute(sql`delete from auth.users where id = ${ownerId}`);
    }
  }, 30_000);
});
