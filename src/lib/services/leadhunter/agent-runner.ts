import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import * as schema from "@/db/schema";
import { leadHunterActivities, leadHunterLeads, leadHunterCampaignVersions, leadHunterEnrollments, leadHunterJobs, leadHunterSourceCandidates } from "@/db/schema";
import { businessIdentitySchema, normalizeIdentityText, type BusinessIdentity } from "@/lib/leadhunter/identity";
import { validatePublicUrl, type FetchLike } from "@/lib/leadhunter/safe-url";
import { resolveSourceCandidateIdentity } from "./identity-manager";
import { claimNextJob, completeJob } from "./job-manager";
import { prepareValidatedMessage } from "./message-manager";

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
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*$/gi, " ")
    .replace(/<a\b[^>]*href=["']mailto:([^"'?]+)[^"']*["'][^>]*>/gi, (_tag, address: string) => `${address} `)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/?(?:address|article|aside|blockquote|br|div|dl|dt|dd|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function publishedBusinessName(html: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map((m) => [m[1]!.toLowerCase(), m[2]!]));
    if ((attrs.property ?? attrs.name)?.toLowerCase() === "og:site_name" && attrs.content?.trim()) return decodeHtmlEntities(attrs.content).trim().slice(0, 200);
  }
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const raw = JSON.parse(match[1]!);
      const entries = Array.isArray(raw) ? raw : Array.isArray(raw["@graph"]) ? raw["@graph"] : [raw];
      for (const item of entries) {
        if (["Organization", "LocalBusiness", "WebSite"].includes(item?.["@type"]) && typeof item.name === "string" && item.name.trim()) return item.name.trim().slice(0, 200);
      }
    } catch { /* A broken structured-data block is not an identity source. */ }
  }
  return null;
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
    if (Number.isFinite(contentLength) && contentLength > 2_000_000) return null;
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 2_000_000) return null;
        chunks.push(value);
      }
      return Buffer.concat(chunks).toString("utf8");
    } finally { await reader.cancel(); }
  }
  return null;
}

export function researchPageLinks(sourceUrl: string, html: string): string[] {
  const source = new URL(sourceUrl);
  const links = new Map<string, number>();
  if (source.pathname !== "/") links.set(source.origin + "/", 0);
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(decodeHtmlEntities(match[1]!), source);
      if (url.origin !== source.origin || url.username || url.password || url.search) continue;
      url.hash = "";
      if (url.toString() === source.toString()) continue;
      const text = `${url.pathname} ${htmlToResearchText(match[2]!)}`;
      const priority = /contact|contacto/i.test(text) ? 1 : /nosotros|about|empresa|company|quienes/i.test(text) ? 2 : /faq|preguntas|servicios|services|mayorista|wholesale/i.test(text) ? 3 : null;
      if (priority !== null) links.set(url.toString(), priority);
    } catch { /* Ignore invalid links in third-party content. */ }
  }
  return [...links].sort((a, b) => a[1] - b[1]).map(([url]) => url).slice(0, 3);
}

async function researchPages(candidate: CandidateContext, fetcher: FetchLike, captured?: string | null) {
  const initial = captured ?? await fetchResearchPage(candidate.canonicalUrl, fetcher);
  if (!initial) throw new Error("Research page unavailable; search snippets are not verified business evidence");
  const pages = [{ sourceUrl: candidate.canonicalUrl, content: htmlToResearchText(initial) }];
  const identity = identityFromCandidate(candidate);
  if (identity.urls.some(({ role }) => role === "official_website")) {
    const links = researchPageLinks(candidate.canonicalUrl, initial).slice(0, 2);
    const results = await Promise.allSettled(links.map(async (sourceUrl) => {
      const html = await fetchResearchPage(sourceUrl, fetcher);
      return html ? { sourceUrl, content: htmlToResearchText(html) } : null;
    }));
    for (const result of results) if (result.status === "fulfilled" && result.value) pages.push(result.value);
  }
  return pages.filter(({ content }) => content.length >= 80).map((page) => ({ ...page, content: page.content.slice(0, 95_000) }));
}

export async function runAgentIdentityResolution(database: Database, maximumJobs = 1, fetcher: FetchLike = fetch) {
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
        let captured: string | null = null;
        let verifiedName: string | null = null;
        const observation = identityFromCandidate(candidate);
        if (observation.urls.some(({ role }) => role === "official_website")) {
          captured = await fetchResearchPage(candidate.canonicalUrl, fetcher);
          verifiedName = captured ? publishedBusinessName(captured) : null;
        }
        const resolution = await resolveSourceCandidateIdentity(database, { ownerId: job.ownerId, candidateId, observation: identityFromCandidate(candidate) });
        if (resolution.leadId && verifiedName && verifiedName !== observation.name && !resolution.outboundProtection.blocked) {
          await database.transaction(async (tx) => {
            const changed = await tx.execute(sql`update ${leadHunterLeads} set name=${verifiedName},normalized_name=${normalizeIdentityText(verifiedName)} where owner_id=${job.ownerId} and id=${resolution.leadId} and name=${observation.name} returning id`) as unknown as Array<{ id: string }>;
            if (changed.length) await tx.execute(sql`insert into ${leadHunterActivities} (owner_id,campaign_id,lead_id,actor_type,event_type,detail) values (${job.ownerId},${candidate.campaignId},${resolution.leadId},'system','identity.name_verified',${JSON.stringify({ sourceUrl: candidate.canonicalUrl, discoveredName: observation.name, verifiedName })}::jsonb)`);
          });
        }
        if (resolution.leadId && !resolution.outboundProtection.blocked) {
          const enrollmentRows = await database.execute(sql<{ id: string }>`select id from ${leadHunterEnrollments} where owner_id=${job.ownerId} and campaign_id=${candidate.campaignId} and lead_id=${resolution.leadId} limit 1`) as unknown as Array<{ id: string }>;
          const enrollmentId = enrollmentRows[0]?.id;
          if (enrollmentId) {
            const pages = await researchPages(candidate, fetcher, captured);
            if (!pages.length) throw new Error("No usable business content found");
            const suppliedAt = new Date().toISOString();
            await database.transaction(async (tx) => {
              for (const { sourceUrl, content } of pages) {
                const payload = { leadId: resolution.leadId, sourceCandidateId: candidateId, source: { sourceUrl, sourceType: candidate.sourceType, suppliedAt, contentSha256: createHash("sha256").update(content).digest("hex") }, content, questions: candidate.snapshot.strategy.research.questions, budget: { maxRuntimeMs: 60_000, maxModelCalls: 1, maxInputTokens: 50_000, maxOutputTokens: 4_000, maxCostUsd: 1 } };
                await tx.execute(sql`insert into ${leadHunterJobs} (owner_id,run_id,enrollment_id,lead_id,kind,payload,idempotency_key) values (${job.ownerId},${job.runId},${enrollmentId},${resolution.leadId},'research',${JSON.stringify(payload)}::jsonb,${`run:${job.runId}:research:${enrollmentId}:${createHash("sha256").update(sourceUrl).digest("hex").slice(0, 16)}`}) on conflict (owner_id,idempotency_key) do nothing`);
              }
            });
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

const prepareMessagePayloadSchema = z.object({
  enrollmentId: z.string().uuid(),
}).strict();

export async function runAgentMessagePreparation(database: Database, maximumJobs = 1) {
  let processed = 0;
  let failed = 0;
  for (let index = 0; index < maximumJobs; index += 1) {
    const job = await database.transaction((tx) => claimNextJob(tx, {
      now: new Date(),
      leaseDurationMs: leaseMs,
      maxAttempts: 3,
      kinds: ["prepare_message"],
    }));
    if (!job) break;
    if (!job.ownerId) throw new Error("Claimed job provenance is missing");
    try {
      const { enrollmentId } = prepareMessagePayloadSchema.parse(job.payload);
      const prepared = await prepareValidatedMessage(database, job.ownerId, enrollmentId);
      await database.transaction((tx) => completeJob(tx, {
        id: job.id,
        leaseToken: job.leaseToken,
        now: new Date(),
        maxAttempts: 3,
        completion: { result: {
          kind: "prepare_message",
          output: { messageVersionId: prepared.messageVersionId },
        } },
      }));
      processed += 1;
    } catch (error) {
      failed += 1;
      await database.transaction((tx) => completeJob(tx, {
        id: job.id,
        leaseToken: job.leaseToken,
        now: new Date(),
        maxAttempts: 3,
        completion: { error: error instanceof Error ? error.message : "Message preparation failed" },
      })).catch(() => undefined);
    }
  }
  return { processed, failed };
}
