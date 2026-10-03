export type PipelineStage = "resolve_identity" | "research" | "audit_website" | "qualify" | "enrich_contact" | "prepare_message" | "validate_message";

export function nextPipelineStage(stage: PipelineStage, output: Record<string, unknown>): PipelineStage | null {
  if (stage === "resolve_identity") return output.leadId ? "research" : null;
  if (stage === "research") return "audit_website";
  if (stage === "audit_website") return "qualify";
  if (stage === "qualify") return output.decision === "eligible" || output.decision === "no_email" ? "enrich_contact" : null;
  if (stage === "enrich_contact") return output.outcome === "selected" && output.outboundBlocked !== true ? "prepare_message" : null;
  if (stage === "prepare_message") return "validate_message";
  return null;
}

import { sql } from "drizzle-orm";
import { leadHunterActivities, leadHunterEvidence, leadHunterJobs, leadHunterLeads, leadHunterRuns } from "@/db/schema";
import type { LeadHunterJobDatabase } from "./job-manager";

export interface PipelineJobContext { ownerId: string; runId: string; enrollmentId: string | null; leadId: string | null; kind: PipelineStage }

export async function advancePipelineAfterResult(database: LeadHunterJobDatabase, context: PipelineJobContext, output: Record<string, unknown>) {
  const next = nextPipelineStage(context.kind, output);
  if (!next || !context.enrollmentId || !context.leadId) return null;
  let payload: Record<string, unknown>;
  if (next === "audit_website") {
    const leads = await database.execute(sql<{ website: string | null }>`select ${leadHunterLeads.website} from ${leadHunterLeads} where owner_id=${context.ownerId} and id=${context.leadId} limit 1`) as unknown as Array<{ website: string | null }>;
    const sources = await database.execute(sql<{ sourceUrl: string | null }>`select source_url as "sourceUrl" from ${leadHunterEvidence} where owner_id=${context.ownerId} and lead_id=${context.leadId} and source_url is not null order by confidence desc limit 1`) as unknown as Array<{ sourceUrl: string | null }>;
    payload = { leadId: context.leadId, website: leads[0]?.website ?? null, sourceUrl: sources[0]?.sourceUrl ?? undefined };
  } else if (next === "enrich_contact") {
    const rows = await database.execute(sql<{ id: string; sourceUrl: string; sourceType: string; contentHash: string; suppliedAt: Date | string }>`
      select id,source_url as "sourceUrl",source_type as "sourceType",content_hash as "contentHash",observed_at as "suppliedAt"
      from ${leadHunterEvidence} where owner_id=${context.ownerId} and lead_id=${context.leadId}
        and source_url is not null and content_hash is not null order by confidence desc limit 25
    `) as unknown as Array<{ id: string; sourceUrl: string; sourceType: string; contentHash: string; suppliedAt: Date | string }>;
    if (!rows.length) return null;
    payload = { leadId: context.leadId, sources: rows.map((row) => ({ ref: `evidence:${row.id}`, sourceUrl: row.sourceUrl, sourceType: row.sourceType, contentSha256: row.contentHash, suppliedAt: new Date(row.suppliedAt).toISOString() })) };
  } else if (next === "prepare_message") {
    payload = { enrollmentId: context.enrollmentId };
  } else {
    payload = next === "validate_message" ? { messageVersionId: String(output.messageVersionId) } : { leadId: context.leadId };
  }
  const key = `run:${context.runId}:${next}:${context.enrollmentId}`;
  const inserted = await database.execute(sql<{ id: string }>`
    insert into ${leadHunterJobs} (owner_id,run_id,enrollment_id,lead_id,kind,payload,idempotency_key)
    values (${context.ownerId},${context.runId},${context.enrollmentId},${context.leadId},${next},${JSON.stringify(payload)}::jsonb,${key})
    on conflict (owner_id,idempotency_key) do nothing returning id
  `) as unknown as Array<{ id: string }>;
  if (inserted[0]) {
    await database.execute(sql`update ${leadHunterRuns} set state='running',finished_at=null where owner_id=${context.ownerId} and id=${context.runId}`);
    await database.execute(sql`insert into ${leadHunterActivities} (owner_id,lead_id,actor_type,event_type,detail) values (${context.ownerId},${context.leadId},'system','pipeline.stage_queued',${JSON.stringify({ runId: context.runId, enrollmentId: context.enrollmentId, stage: next })}::jsonb)`);
  }
  return inserted[0]?.id ?? null;
}
