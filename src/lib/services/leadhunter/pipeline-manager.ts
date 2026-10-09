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
  const runs = await database.execute(sql`
    select plan->>'executionMode' as "executionMode" from ${leadHunterRuns}
    where owner_id=${context.ownerId} and id=${context.runId}
  `) as unknown as Array<{ executionMode: string | null }>;
  if (runs[0]?.executionMode === "research_only" && context.kind !== "resolve_identity") return null;
  if (runs[0]?.executionMode === "qualification_only" && ["qualify", "enrich_contact", "prepare_message"].includes(context.kind)) return null;
  let payload: Record<string, unknown>;
  if (next === "audit_website") {
    const unfinished = await database.execute(sql`select id from ${leadHunterJobs} where owner_id=${context.ownerId} and run_id=${context.runId} and enrollment_id=${context.enrollmentId} and kind='research' and state in ('queued','leased') limit 1`) as unknown as Array<{ id: string }>;
    if (unfinished.length) return null;
    const leads = await database.execute(sql<{ website: string | null }>`select ${leadHunterLeads.website} from ${leadHunterLeads} where owner_id=${context.ownerId} and id=${context.leadId} limit 1`) as unknown as Array<{ website: string | null }>;
    const sources = await database.execute(sql<{ sourceUrl: string | null }>`select source_url as "sourceUrl" from ${leadHunterEvidence} where owner_id=${context.ownerId} and lead_id=${context.leadId} and source_url is not null order by confidence desc limit 1`) as unknown as Array<{ sourceUrl: string | null }>;
    payload = { leadId: context.leadId, website: leads[0]?.website ?? null, sourceUrl: sources[0]?.sourceUrl ?? undefined };
  } else if (next === "enrich_contact") {
    const rows = await database.execute(sql`
      select id,payload from ${leadHunterJobs} where owner_id=${context.ownerId} and run_id=${context.runId}
        and enrollment_id=${context.enrollmentId} and kind='research' and state='succeeded'
        and payload->>'content' is not null order by id limit 25
    `) as unknown as Array<{ id: string; payload: { sourceCandidateId?: string; source: { sourceUrl: string; sourceType: string; contentSha256: string; suppliedAt: string }; content: string } }>;
    if (!rows.length) return null;
    payload = { leadId: context.leadId, sources: rows.map((row) => ({ ref: `research:${row.id}`, ...row.payload.source, content: row.payload.content, ...(row.payload.sourceCandidateId ? { sourceCandidateId: row.payload.sourceCandidateId } : {}) })) };
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
