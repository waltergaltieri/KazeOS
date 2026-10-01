import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/db/schema";
import { leadHunterCampaignVersions, leadHunterEnrollments, leadHunterJobs, leadHunterSourceCandidates } from "@/db/schema";
import type { BusinessIdentity } from "@/lib/leadhunter/identity";
import { createSourceRegistry } from "@/lib/leadhunter/sources/registry";
import type { SearchPlanWorkItem } from "@/lib/leadhunter/sources/contracts";
import { persistDiscoveryPage } from "./discovery-manager";
import { resolveSourceCandidateIdentity } from "./identity-manager";
import { claimNextJob, completeJob } from "./job-manager";

type Database = PostgresJsDatabase<typeof schema>;
const leaseMs = 5 * 60_000;

function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }

interface CandidateContext { canonicalUrl: string; sourceType: string; rawRecord: { observedName?: string | null; observedLocation?: string | null; metadata?: { snippet?: string } }; campaignId: string; campaignVersion: number; snapshot: schema.LeadHunterCampaignSnapshot }

function identityFromCandidate(candidate: CandidateContext): BusinessIdentity {
  const host = new URL(candidate.canonicalUrl).hostname.toLowerCase();
  const role = /(^|\.)(instagram|linkedin|facebook|yelp)\.com$|paginasamarillas/i.test(host) ? (host.includes("instagram") || host.includes("linkedin") || host.includes("facebook") ? "social_profile" : "directory") : "official_website";
  return { name: candidate.rawRecord.observedName?.trim() || null, emails: [], urls: [{ url: candidate.canonicalUrl, role }], location: { countryCode: candidate.snapshot.countries.length === 1 ? candidate.snapshot.countries[0]! : null, city: candidate.rawRecord.observedLocation ?? null, address: null }, organizationRole: "unknown", parentName: null };
}

function researchContent(candidate: CandidateContext) {
  const name = candidate.rawRecord.observedName?.trim() || "Negocio encontrado";
  const snippet = candidate.rawRecord.metadata?.snippet?.trim() || name;
  return `<article><h1 data-lh-field="business_model">${escapeHtml(name)}</h1><p data-lh-field="digital_presence">${escapeHtml(candidate.canonicalUrl)}</p><p data-lh-field="observable_process">${escapeHtml(snippet)}</p><p data-lh-field="service_opportunity">${escapeHtml(snippet)}</p></article>`;
}

export async function runAgentDiscovery(database: Database, maximumJobs = 20) {
  const registry = createSourceRegistry();
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < maximumJobs; index += 1) {
    const job = await database.transaction((tx) => claimNextJob(tx, { now: new Date(), leaseDurationMs: leaseMs, maxAttempts: 3, kinds: ["discover", "resolve_identity"] }));
    if (!job) break;
    if (!job.ownerId || !job.runId) throw new Error("Claimed job provenance is missing");
    try {
      if (job.kind === "discover") {
        const work = job.payload as SearchPlanWorkItem;
        const page = await registry.forWork(work).discover(work);
        const stored = await persistDiscoveryPage(database, { ownerId: job.ownerId, runId: job.runId, work, page });
        await database.transaction((tx) => completeJob(tx, { id: job.id, leaseToken: job.leaseToken, now: new Date(), maxAttempts: 3, completion: { result: { kind: "discover", output: { candidateCount: stored.storedCandidates, nextCursor: stored.nextCursor } } } }));
      } else {
        const candidateId = String((job.payload as { candidateId?: unknown }).candidateId ?? "");
        const rows = await database.execute(sql<CandidateContext>`
          select candidate.canonical_url as "canonicalUrl",candidate.source_type as "sourceType",candidate.raw_record as "rawRecord",
            run.campaign_id as "campaignId",run.campaign_version as "campaignVersion",version.snapshot
          from ${leadHunterSourceCandidates} candidate join lh_runs run on run.owner_id=candidate.owner_id and run.id=candidate.run_id
          join ${leadHunterCampaignVersions} version on version.owner_id=run.owner_id and version.campaign_id=run.campaign_id and version.version=run.campaign_version
          where candidate.owner_id=${job.ownerId} and candidate.id=${candidateId} limit 1
        `) as unknown as CandidateContext[];
        const candidate = rows[0];
        if (!candidate) throw new Error("Candidate not found");
        const resolution = await resolveSourceCandidateIdentity(database, { ownerId: job.ownerId, candidateId, observation: identityFromCandidate(candidate) });
        if (resolution.leadId && !resolution.outboundProtection.blocked) {
          const enrollmentRows = await database.execute(sql<{ id: string }>`select id from ${leadHunterEnrollments} where owner_id=${job.ownerId} and campaign_id=${candidate.campaignId} and lead_id=${resolution.leadId} limit 1`) as unknown as Array<{ id: string }>;
          const enrollmentId = enrollmentRows[0]?.id;
          if (enrollmentId) {
            const content = researchContent(candidate);
            const suppliedAt = new Date().toISOString();
            const payload = { leadId: resolution.leadId, source: { sourceUrl: candidate.canonicalUrl, sourceType: candidate.sourceType, suppliedAt, contentSha256: createHash("sha256").update(content).digest("hex") }, content, questions: candidate.snapshot.strategy.research.questions, budget: { maxRuntimeMs: 60_000, maxModelCalls: 1, maxInputTokens: 50_000, maxOutputTokens: 4_000, maxCostUsd: 1 } };
            await database.execute(sql`insert into ${leadHunterJobs} (owner_id,run_id,enrollment_id,lead_id,kind,payload,idempotency_key) values (${job.ownerId},${job.runId},${enrollmentId},${resolution.leadId},'research',${JSON.stringify(payload)}::jsonb,${`run:${job.runId}:research:${enrollmentId}`}) on conflict (owner_id,idempotency_key) do nothing`);
          }
        }
        await database.transaction((tx) => completeJob(tx, { id: job.id, leaseToken: job.leaseToken, now: new Date(), maxAttempts: 3, completion: { result: { kind: "resolve_identity", output: { leadId: resolution.leadId, confidence: resolution.resolutionState === "resolved" ? 1 : .5 } } } }));
      }
      processed += 1;
    } catch (error) {
      failed += 1;
      await database.transaction((tx) => completeJob(tx, { id: job.id, leaseToken: job.leaseToken, now: new Date(), maxAttempts: 3, completion: { error: error instanceof Error ? error.message : "Agent stage failed" } })).catch(() => undefined);
    }
  }
  return { processed, failed };
}
