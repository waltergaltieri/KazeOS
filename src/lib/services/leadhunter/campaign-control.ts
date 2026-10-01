import "server-only";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "@/db/schema";
import { leadHunterActivities, leadHunterCampaigns, leadHunterJobs, leadHunterOutbox } from "@/db/schema";

type Database = Pick<PostgresJsDatabase<typeof schema>, "execute">;

export async function controlCampaign(database: Database, input: { ownerId: string; campaignId: string; command: "activate" | "pause" | "run_now"; now?: Date }) {
  const now = input.now ?? new Date();
  const nowTimestamp = now.toISOString();
  if (input.command === "pause") {
    await database.execute(sql`update ${leadHunterCampaigns} set status='paused',next_search_at=null where owner_id=${input.ownerId} and id=${input.campaignId} and status<>'archived'`);
    await database.execute(sql`update ${leadHunterJobs} job set state='cancelled' from lh_runs run where job.owner_id=${input.ownerId} and job.run_id=run.id and run.campaign_id=${input.campaignId} and job.state='queued'`);
    await database.execute(sql`update ${leadHunterOutbox} outbox set state='cancelled' from lh_enrollments enrollment where outbox.owner_id=${input.ownerId} and outbox.enrollment_id=enrollment.id and enrollment.campaign_id=${input.campaignId} and outbox.state='queued'`);
  } else {
    await database.execute(sql`update ${leadHunterCampaigns} set status='active',automation_mode='automatic',mailbox_id=coalesce(mailbox_id,id),next_search_at=${nowTimestamp} where owner_id=${input.ownerId} and id=${input.campaignId} and status<>'archived'`);
  }
  await database.execute(sql`insert into ${leadHunterActivities} (owner_id,campaign_id,actor_type,event_type,detail) values (${input.ownerId},${input.campaignId},'human',${`campaign.${input.command}`},${JSON.stringify({ at: now.toISOString() })}::jsonb)`);
}
