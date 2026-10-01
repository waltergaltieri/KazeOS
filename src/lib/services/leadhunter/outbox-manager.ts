import "server-only";

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/db/schema";
import { leadHunterActivities, leadHunterEnrollments, leadHunterOutbox } from "@/db/schema";
import type { MailTransportCommand } from "@/lib/leadhunter/outbox";

export type OutboxDatabase = Pick<PostgresJsDatabase<typeof schema>, "execute">;

interface ClaimedRow { outboxId: string; recipient: string; subject: string; body: string; dueAt: Date | string; idempotencyKey: string }

export async function claimDueMail(database: OutboxDatabase, input: { now: Date; leaseOwner: string; limit?: number; leaseMinutes?: number }): Promise<MailTransportCommand[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 10, 50));
  const leaseMinutes = Math.max(1, Math.min(input.leaseMinutes ?? 10, 60));
  const nowTimestamp = input.now.toISOString();
  const rows = await database.execute(sql<ClaimedRow>`
    with base as (
      select outbox.id,outbox.owner_id,outbox.due_at,campaign.id as campaign_id,campaign.daily_email_limit,campaign.schedule
      from ${leadHunterOutbox} outbox
      join ${leadHunterEnrollments} enrollment on enrollment.owner_id=outbox.owner_id and enrollment.id=outbox.enrollment_id
      join lh_campaigns campaign on campaign.owner_id=enrollment.owner_id and campaign.id=enrollment.campaign_id
      where outbox.state='queued' and outbox.due_at<=${nowTimestamp}
        and campaign.status='active' and campaign.automation_mode='automatic' and campaign.mailbox_id is not null
        and enrollment.status in ('ready','contacting')
      order by outbox.due_at,outbox.id
      for update of outbox skip locked
    ), ranked as (
      select base.id,base.campaign_id,base.daily_email_limit,
        row_number() over (partition by base.campaign_id order by base.due_at,base.id) as campaign_rank,
        (select count(*) from lh_outbox sent join lh_enrollments sent_enrollment on sent_enrollment.owner_id=sent.owner_id and sent_enrollment.id=sent.enrollment_id
          where sent.owner_id=base.owner_id and sent_enrollment.campaign_id=base.campaign_id and sent.state='provider_accepted'
            and (sent.updated_at at time zone (base.schedule->>'timezone'))::date=(${nowTimestamp}::timestamptz at time zone (base.schedule->>'timezone'))::date) as sent_today
      from base
    ), candidates as (
      select id from ranked where campaign_rank<=greatest(daily_email_limit-sent_today,0) order by id limit ${limit}
    )
    update ${leadHunterOutbox} outbox set state='leased', lease_owner=${input.leaseOwner},
      lease_expires_at=${nowTimestamp}::timestamptz + (${leaseMinutes} * interval '1 minute'), attempt_count=attempt_count+1
    from candidates where outbox.id=candidates.id
    returning outbox.id as "outboxId", outbox.recipient_email as recipient, outbox.subject, outbox.body,
      outbox.due_at as "dueAt", outbox.idempotency_key as "idempotencyKey"
  `) as unknown as ClaimedRow[];
  return rows.map((row) => ({ ...row, dueAt: new Date(row.dueAt).toISOString() }));
}

export async function settleMail(database: OutboxDatabase, input: { outboxId: string; leaseOwner: string; result: "accepted" | "failed" | "unknown"; providerMessageId?: string; error?: string }) {
  const state = input.result === "accepted" ? "provider_accepted" : input.result;
  const rows = await database.execute(sql<{ enrollmentId: string; ownerId: string }>`
    update ${leadHunterOutbox} set state=${state}::lh_outbox_state, provider_message_id=${input.providerMessageId ?? null},
      last_error=${input.error?.slice(0, 1000) ?? null}, lease_owner=null, lease_expires_at=null
    where id=${input.outboxId} and state='leased' and lease_owner=${input.leaseOwner}
    returning enrollment_id as "enrollmentId", owner_id as "ownerId"
  `) as unknown as Array<{ enrollmentId: string; ownerId: string }>;
  const row = rows[0];
  if (!row) return false;
  if (input.result === "accepted") await database.execute(sql`update ${leadHunterEnrollments} set status='contacting' where owner_id=${row.ownerId} and id=${row.enrollmentId} and status='ready'`);
  return true;
}

export async function recordMailEvent(database: OutboxDatabase, input: { providerMessageId: string; event: "replied" | "bounced"; occurredAt: Date }) {
  const rows = await database.execute(sql<{ ownerId: string; enrollmentId: string; campaignId: string; leadId: string }>`
    select outbox.owner_id as "ownerId",outbox.enrollment_id as "enrollmentId",enrollment.campaign_id as "campaignId",enrollment.lead_id as "leadId"
    from ${leadHunterOutbox} outbox join ${leadHunterEnrollments} enrollment on enrollment.owner_id=outbox.owner_id and enrollment.id=outbox.enrollment_id
    where outbox.provider_message_id=${input.providerMessageId} limit 1
  `) as unknown as Array<{ ownerId: string; enrollmentId: string; campaignId: string; leadId: string }>;
  const row = rows[0];
  if (!row) return false;
  await database.execute(sql`update ${leadHunterEnrollments} set status=${input.event === "replied" ? "replied" : "stopped"}::lh_enrollment_status,next_action_at=null where owner_id=${row.ownerId} and id=${row.enrollmentId}`);
  await database.execute(sql`update ${leadHunterOutbox} set state='cancelled' where owner_id=${row.ownerId} and enrollment_id=${row.enrollmentId} and state='queued'`);
  await database.execute(sql`insert into ${leadHunterActivities} (owner_id,campaign_id,lead_id,actor_type,event_type,detail,occurred_at) values (${row.ownerId},${row.campaignId},${row.leadId},'system',${`mail.${input.event}`},${JSON.stringify({ providerMessageId: input.providerMessageId })}::jsonb,${input.occurredAt.toISOString()})`);
  return true;
}

export async function releaseExpiredMail(database: OutboxDatabase, now = new Date()) {
  await database.execute(sql`update ${leadHunterOutbox} set state=case when attempt_count>=3 then 'failed'::lh_outbox_state else 'queued'::lh_outbox_state end, lease_owner=null,lease_expires_at=null,last_error='Transport lease expired' where state='leased' and lease_expires_at<=${now.toISOString()}`);
}
