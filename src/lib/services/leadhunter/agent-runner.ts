import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/db/schema";
import { leadHunterCampaignVersions, leadHunterEnrollments, leadHunterJobs, leadHunterSourceCandidates } from "@/db/schema";
import { businessIdentitySchema, type BusinessIdentity } from "@/lib/leadhunter/identity";
import { validatePublicUrl, type FetchLike } from "@/lib/leadhunter/safe-url";
import { resolveSourceCandidateIdentity } from "./identity-manager";
import { claimNextJob, completeJob } from "./job-manager";

type Database = PostgresJsDatabase<typeof schema>;
const leaseMs = 5 * 60_000;

interface CandidateContext { canonicalUrl: string; sourceType: string; rawRecord: { observedName?: string | null; observedLocation?: string | null; metadata?: { identity?: unknown; snippet?: string } }; campaignId: string; campaignVersion: number; snapshot: schema.LeadHunterCampaignSnapshot }

const htmlEntityNames: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\"",
};

function decodeHtmlEntities(value: string) {
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (entity, key: string) => {
    if (key.startsWith("#")) {
      const hexadecimal = key[1]?.toLowerCase() === "x";
      const codePoint = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
        try { return String.fromCodePoint(codePoint); } catch { return entity; }
      }
      return entity;
    }
    return htmlEntityNames[key.toLowerCase()] ?? entity;
  });
}

export function htmlToResearchText(html: string) {
  return decodeHtmlEntities(html
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?(?:address|article|aside|blockquote|br|div|dl|dt|dd|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function identityFromCandidate(candidate: CandidateContext): BusinessIdentity {
  const persistedIdentity = candidate.rawRecord.metadata?.identity;
  if (persistedIdentity !== undefined) {
    return businessIdentitySchema.parse(persistedIdentity);
  }
  return businessIdentitySchema.parse({
    name: candidate.rawRecord.observedName?.trim() || null,
    emails: [],
    urls: [{ url: candidate.canonicalUrl, role: "directory" }],
    location: candidate.rawRecord.observedLocation
      ? { city: candidate.rawRecord.observedLocation }
      : {},
    organizationRole: "unknown",
  });
}

async function fetchResearchPage(url: string, fetcher: FetchLike): Promise<string | null> {
  let currentUrl = url;
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const validated = await validatePublicUrl(currentUrl);
    const response = await fetcher(validated.requestUrl, {
      redirect: "manual",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "KazeOS-LeadHunter/1.0",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return null;
      currentUrl = new URL(location, validated.requestUrl).toString();
      continue;
    }
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type")?.toLocaleLowerCase() ?? "";
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) return null;
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 500_000) return null;
    return (await response.text()).slice(0, 95_000);
  }
  return null;
}

async function researchContent(candidate: CandidateContext, fetcher: FetchLike) {
  const name = candidate.rawRecord.observedName?.trim() || "Negocio encontrado";
  const snippet = candidate.rawRecord.metadata?.snippet?.trim() || name;
  let page: string | null = null;
  try {
    page = await fetchResearchPage(candidate.canonicalUrl, fetcher);
  } catch {
    page = null;
  }
  return [
    `Negocio: ${name}`,
    `Fuente pública: ${candidate.canonicalUrl}`,
    `Resumen del buscador: ${snippet}`,
    page ? `Contenido visible del sitio:\n${htmlToResearchText(page)}` : "",
  ].filter(Boolean).join("\n").slice(0, 100_000);
}

export async function runAgentIdentityResolution(database: Database, maximumJobs = 20, fetcher: FetchLike = fetch) {
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < maximumJobs; index += 1) {
    const job = await database.transaction((tx) => claimNextJob(tx, { now: new Date(), leaseDurationMs: leaseMs, maxAttempts: 3, kinds: ["resolve_identity"] }));
    if (!job) break;
    if (!job.ownerId || !job.runId) throw new Error("Claimed job provenance is missing");
    try {
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
            const content = await researchContent(candidate, fetcher);
            const suppliedAt = new Date().toISOString();
            const payload = { leadId: resolution.leadId, source: { sourceUrl: candidate.canonicalUrl, sourceType: candidate.sourceType, suppliedAt, contentSha256: createHash("sha256").update(content).digest("hex") }, content, questions: candidate.snapshot.strategy.research.questions, budget: { maxRuntimeMs: 60_000, maxModelCalls: 1, maxInputTokens: 50_000, maxOutputTokens: 4_000, maxCostUsd: 1 } };
            await database.execute(sql`insert into ${leadHunterJobs} (owner_id,run_id,enrollment_id,lead_id,kind,payload,idempotency_key) values (${job.ownerId},${job.runId},${enrollmentId},${resolution.leadId},'research',${JSON.stringify(payload)}::jsonb,${`run:${job.runId}:research:${enrollmentId}`}) on conflict (owner_id,idempotency_key) do nothing`);
          }
        }
      await database.transaction((tx) => completeJob(tx, { id: job.id, leaseToken: job.leaseToken, now: new Date(), maxAttempts: 3, completion: { result: { kind: "resolve_identity", output: { leadId: resolution.leadId, confidence: resolution.resolutionState === "resolved" ? 1 : .5 } } } }));
      processed += 1;
    } catch (error) {
      failed += 1;
      await database.transaction((tx) => completeJob(tx, { id: job.id, leaseToken: job.leaseToken, now: new Date(), maxAttempts: 3, completion: { error: error instanceof Error ? error.message : "Agent stage failed" } })).catch(() => undefined);
    }
  }
  return { processed, failed };
}
