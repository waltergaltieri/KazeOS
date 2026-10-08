import "server-only";

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/db/schema";
import { leadHunterActivities, leadHunterCampaigns, leadHunterCampaignVersions, leadHunterContacts, leadHunterEnrollments, leadHunterEvidence, leadHunterMessageBriefs, leadHunterMessageVersions, leadHunterOutbox } from "@/db/schema";
import { buildMessageBrief, type BriefEvidence, type MessageBrief } from "@/lib/leadhunter/message-brief";
import { validateFollowUpMessage, validateProspectMessage } from "@/lib/leadhunter/message-composer";
import { nextDeliveryWindow } from "@/lib/leadhunter/outbox";
import { composeFollowUpsWithMiniMax, composeProspectMessageWithMiniMax, reviewMessageGrounding } from "@/lib/leadhunter/minimax-message";

export type MessageDatabase = Pick<PostgresJsDatabase<typeof schema>, "execute">;

interface ContextRow {
  enrollmentId: string; leadId: string; campaignId: string; campaignVersion: number;
  companyName: string; evaluation: string; status: string; campaignStatus: string;
  automationMode: string; mailboxId: string | null; snapshot: schema.LeadHunterCampaignSnapshot;
  contactId: string; email: string; firstName: string | null; role: string | null;
}

const opportunity: Record<string, string> = {
  custom_management: "automatizar y ordenar los procesos del negocio",
  web: "mejorar la presencia web y convertir más consultas",
  ecommerce: "incorporar ventas y pedidos en línea",
  ai_bots: "automatizar consultas repetitivas con un asistente de IA",
  automation: "reducir tareas manuales mediante automatizaciones",
};

export async function prepareValidatedMessage(database: MessageDatabase, ownerId: string, enrollmentId: string, now = new Date()) {
  const nowTimestamp = now.toISOString();
  const rows = await database.execute(sql<ContextRow>`
    select enrollment.id as "enrollmentId", enrollment.lead_id as "leadId", enrollment.campaign_id as "campaignId",
      enrollment.campaign_version as "campaignVersion", enrollment.evaluation, enrollment.status,
      lead.name as "companyName", campaign.status as "campaignStatus", campaign.automation_mode as "automationMode",
      campaign.mailbox_id as "mailboxId", version.snapshot, contact.id as "contactId", contact.email,
      contact.first_name as "firstName", contact.role
    from ${leadHunterEnrollments} enrollment
    join ${schema.leadHunterLeads} lead on lead.owner_id=enrollment.owner_id and lead.id=enrollment.lead_id
    join ${leadHunterCampaigns} campaign on campaign.owner_id=enrollment.owner_id and campaign.id=enrollment.campaign_id
    join ${leadHunterCampaignVersions} version on version.owner_id=enrollment.owner_id and version.campaign_id=enrollment.campaign_id and version.version=enrollment.campaign_version
    join ${leadHunterContacts} contact on contact.owner_id=enrollment.owner_id and contact.lead_id=enrollment.lead_id and contact.is_primary=true
    where enrollment.owner_id=${ownerId} and enrollment.id=${enrollmentId}
    for update of enrollment
  `) as unknown as ContextRow[];
  const context = rows[0];
  if (!context || context.evaluation !== "eligible" || !context.email || context.status === "stopped") throw new Error("Enrollment is not ready for messaging");

  const evidence = await database.execute(sql<BriefEvidence>`
    select id, field, value, confidence, status
    from ${leadHunterEvidence}
    where owner_id=${ownerId} and lead_id=${context.leadId} and campaign_id=${context.campaignId}
      and campaign_version=${context.campaignVersion} and status='verified'
      and left(field, 8) <> 'website_'
    order by confidence desc, observed_at desc limit 50
  `) as unknown as BriefEvidence[];
  const builtBrief = buildMessageBrief({
    campaignId: context.campaignId, campaignVersion: context.campaignVersion, enrollmentId,
    companyName: context.companyName,
    contact: { id: context.contactId, email: context.email, firstName: context.firstName, role: context.role },
    evidence, primaryOpportunity: opportunity[context.snapshot.serviceFocus] ?? context.snapshot.objective,
    policy: context.snapshot.strategy.message,
  });
  const existing = await database.execute(sql<{ id: string; brief: MessageBrief }>`
    select id, brief from ${leadHunterMessageBriefs} where owner_id=${ownerId} and enrollment_id=${enrollmentId} and campaign_version=${context.campaignVersion} limit 1
  `) as unknown as Array<{ id: string; brief: MessageBrief }>;
  const brief = existing[0]?.brief ?? builtBrief;
  let briefId = existing[0]?.id;
  if (!briefId) {
    const inserted = await database.execute(sql<{ id: string }>`
      insert into ${leadHunterMessageBriefs} (owner_id,enrollment_id,contact_id,campaign_id,campaign_version,brief,evidence_ids)
      values (${ownerId},${enrollmentId},${context.contactId},${context.campaignId},${context.campaignVersion},${JSON.stringify(brief)}::jsonb,${JSON.stringify(brief.facts.map(({ id }) => id))}::jsonb)
      returning id
    `) as unknown as Array<{ id: string }>;
    briefId = inserted[0]!.id;
  }
  const existingMessage = await database.execute(sql<{ id: string; subject: string; body: string }>`
    select id, subject, body from ${leadHunterMessageVersions} where owner_id=${ownerId} and enrollment_id=${enrollmentId} and state='valid'
      and model_metadata->>'qualityVersion'='2' and coalesce(model_metadata->>'sequenceStep','0')='0'
    order by created_at desc limit 1
  `) as unknown as Array<{ id: string; subject: string; body: string }>;
  let message = existingMessage[0];
  if (!message) {
    let composed = await composeProspectMessageWithMiniMax(brief);
    let validation = validateProspectMessage(brief, composed);
    if (validation.valid) validation = await reviewMessageGrounding(brief, [composed]);
    for (let attempt = 1; !validation.valid && attempt < 2; attempt += 1) {
      composed = await composeProspectMessageWithMiniMax(brief, {
        qualityFeedback: validation.issues,
      });
      validation = validateProspectMessage(brief, composed);
      if (validation.valid) validation = await reviewMessageGrounding(brief, [composed]);
    }
    if (!validation.valid) throw new Error(validation.issues.join(" "));
    const inserted = await database.execute(sql<{ id: string; subject: string; body: string }>`
      insert into ${leadHunterMessageVersions} (owner_id,brief_id,enrollment_id,subject,body,state,validation_result,model_metadata)
      values (${ownerId},${briefId},${enrollmentId},${composed.subject},${composed.body},'valid',${JSON.stringify(validation)}::jsonb,${JSON.stringify({ generator: "minimax", model: process.env.MINIMAX_MODEL ?? "MiniMax-M3", qualityVersion: 2, sequenceStep: 0 })}::jsonb)
      returning id,subject,body
    `) as unknown as Array<{ id: string; subject: string; body: string }>;
    message = inserted[0]!;
  }
  await database.execute(sql`update ${leadHunterEnrollments} set message_version_id=${message.id}, status='ready', next_action_at=${nowTimestamp} where owner_id=${ownerId} and id=${enrollmentId}`);

  let queued = 0;
  if (context.campaignStatus === "active" && context.automationMode === "automatic" && context.mailboxId) {
    const firstDueAt = nextDeliveryWindow(now, context.snapshot.schedule);
    const followUpSteps = context.snapshot.sequenceSteps.slice(1);
    let followUps = await composeFollowUpsWithMiniMax(brief, message.subject, followUpSteps);
    let followUpValidations = followUps.map((followUp) => validateFollowUpMessage(brief, message.subject, followUp));
    for (let attempt = 1; followUpValidations.some(({ valid }) => !valid) && attempt < 2; attempt += 1) {
      followUps = await composeFollowUpsWithMiniMax(brief, message.subject, followUpSteps, {
        qualityFeedback: followUpValidations.flatMap(({ issues }) => issues),
      });
      followUpValidations = followUps.map((followUp) => validateFollowUpMessage(brief, message.subject, followUp));
    }
    const invalidFollowUp = followUpValidations.find(({ valid }) => !valid);
    if (invalidFollowUp) {
      throw new Error(invalidFollowUp.issues.join(" "));
    }
    if (followUps.length) {
      const review = await reviewMessageGrounding(brief, followUps);
      if (!review.valid) throw new Error(review.issues.join(" "));
    }
    let elapsedDays = 0;
    const commands = [{ subject: message.subject, body: message.body, dueAt: firstDueAt }, ...followUps.map((followUp, index) => {
      elapsedDays += followUpSteps[index]!.delayDays;
      return { ...followUp, dueAt: nextDeliveryWindow(new Date(firstDueAt.getTime() + elapsedDays * 86_400_000), context.snapshot.schedule) };
    })];
    for (const [logicalStep, command] of commands.entries()) {
      const alreadyQueued = await database.execute(sql<{ id: string }>`select id from ${leadHunterOutbox} where owner_id=${ownerId} and enrollment_id=${enrollmentId} and logical_step=${logicalStep} and state<>'cancelled' limit 1`) as unknown as Array<{ id: string }>;
      if (alreadyQueued[0]) continue;
      let commandMessageVersionId = message.id;
      if (logicalStep > 0) {
        const followUpVersion = await database.execute(sql<{ id: string }>`
          insert into ${leadHunterMessageVersions} (owner_id,brief_id,enrollment_id,subject,body,state,validation_result,model_metadata)
          values (${ownerId},${briefId},${enrollmentId},${command.subject},${command.body},'valid','{"valid":true,"issues":[]}'::jsonb,${JSON.stringify({ generator: "minimax", model: process.env.MINIMAX_MODEL ?? "MiniMax-M3", sequenceStep: logicalStep })}::jsonb)
          returning id
        `) as unknown as Array<{ id: string }>;
        commandMessageVersionId = followUpVersion[0]!.id;
      }
      const result = await database.execute(sql<{ id: string }>`
        insert into ${leadHunterOutbox} (owner_id,enrollment_id,message_version_id,recipient_email,subject,body,due_at,logical_step,idempotency_key)
        values (${ownerId},${enrollmentId},${commandMessageVersionId},${context.email},${command.subject},${command.body},${command.dueAt.toISOString()},${logicalStep},${`${enrollmentId}:${context.campaignVersion}:${logicalStep}`})
        on conflict (owner_id,idempotency_key) do nothing returning id
      `) as unknown as Array<{ id: string }>;
      queued += result.length;
    }
  }
  await database.execute(sql`insert into ${leadHunterActivities} (owner_id,campaign_id,lead_id,actor_type,event_type,detail) values (${ownerId},${context.campaignId},${context.leadId},'agent','message.prepared',${JSON.stringify({ enrollmentId, messageVersionId: message.id, queued })}::jsonb)`);
  return { briefId, messageVersionId: message.id, queued };
}
