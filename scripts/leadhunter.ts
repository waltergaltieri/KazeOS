/** Operator CLI. Run with: pnpm leadhunter <create|status|run|pause|enable-sending> --owner UUID ... */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { z } from "zod";

config({ path: ".env.local", quiet: true });

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    owner: { type: "string" }, campaign: { type: "string" }, file: { type: "string" },
    mailbox: { type: "string" }, recurring: { type: "boolean", default: false },
    job: { type: "string" },
  } });
  const command = z.enum(["create", "status", "run", "pause", "enable-sending", "retry-failed", "refresh-drafts"]).parse(positionals[0]);
  const ownerId = z.string().uuid().parse(values.owner);
  const { adminDb: db, adminDatabaseClient: client } = await import("../src/db/internal/admin");
  const { createCampaign } = await import("../src/lib/services/leadhunter/campaign-manager");
  const { controlCampaign } = await import("../src/lib/services/leadhunter/campaign-control");
  const { planDueRuns } = await import("../src/lib/services/leadhunter/run-manager");
  const { campaignFormSchema } = await import("../src/lib/validations/leadhunter");
  const { reconcileCampaignStrategy } = await import("../src/lib/leadhunter/contracts");
  try {
    if (command === "create") {
      if (!values.file) throw new Error("--file must name the campaign JSON configuration");
      const configuration = campaignFormSchema.parse(JSON.parse(await readFile(values.file, "utf8")));
      const strategy = reconcileCampaignStrategy(configuration);
      if (strategy.qualification.rules.some((rule) => !rule.predicate)) {
        throw new Error("Every qualification rule needs an executable predicate; prose-only criteria cannot run autonomously");
      }
      const id = await db.transaction((tx) => createCampaign(tx, ownerId, configuration));
      console.log(JSON.stringify({ id, status: "draft", automationMode: "drafts", sendsEnabled: false }));
      return;
    }
    const campaignId = z.string().uuid().parse(values.campaign);
    const campaigns = await db.execute(sql`select id,name,status,automation_mode,mailbox_id,next_search_at from lh_campaigns where owner_id=${ownerId} and id=${campaignId}`);
    if (!campaigns.length) throw new Error("Campaign not found for this owner");
    if (command === "status") {
      const jobs = await db.execute(sql`select j.kind,j.state,count(*)::integer as count, array_remove(array_agg(distinct j.last_error),null) as errors from lh_jobs j join lh_runs r on r.id=j.run_id and r.owner_id=j.owner_id where r.owner_id=${ownerId} and r.campaign_id=${campaignId} group by j.kind,j.state order by j.kind,j.state`);
      const leads = await db.execute(sql`select e.evaluation,e.status,count(*)::integer as count from lh_enrollments e where e.owner_id=${ownerId} and e.campaign_id=${campaignId} group by e.evaluation,e.status`);
      const outbox = await db.execute(sql`select o.state,count(*)::integer as count from lh_outbox o join lh_enrollments e on e.owner_id=o.owner_id and e.id=o.enrollment_id where e.owner_id=${ownerId} and e.campaign_id=${campaignId} group by o.state`);
      console.log(JSON.stringify({ campaign: campaigns[0], jobs, leads, outbox }, null, 2));
    } else if (command === "refresh-drafts") {
      if (campaigns[0]!.automation_mode !== "drafts") throw new Error("Refreshing messages requires drafts mode");
      const jobs = await db.transaction(async (tx) => {
        const inserted = await tx.execute(sql`
          insert into lh_jobs (owner_id,run_id,enrollment_id,lead_id,kind,payload,idempotency_key)
          select e.owner_id,r.id,e.id,e.lead_id,'prepare_message',jsonb_build_object('enrollmentId',e.id),'refresh:quality-v2:'||e.id
          from lh_enrollments e join lateral (select id from lh_runs where owner_id=e.owner_id and campaign_id=e.campaign_id and campaign_version=e.campaign_version order by created_at desc limit 1) r on true
          where e.owner_id=${ownerId} and e.campaign_id=${campaignId} and e.evaluation='eligible' and e.status='ready'
            and not exists(select 1 from lh_outbox o where o.owner_id=e.owner_id and o.enrollment_id=e.id)
          on conflict(owner_id,idempotency_key) do nothing returning id,run_id
        `);
        for (const job of inserted) await tx.execute(sql`update lh_runs set state='running',finished_at=null where owner_id=${ownerId} and id=${job.run_id as string}`);
        await tx.execute(sql`insert into lh_activity (owner_id,campaign_id,actor_type,event_type,detail) values (${ownerId},${campaignId},'human','drafts.refresh_requested',${JSON.stringify({ jobs: inserted.map(({ id }) => id), qualityVersion: 2 })}::jsonb)`);
        return inserted;
      });
      console.log(JSON.stringify({ queued: jobs.length, sendsEnabled: false }));
    } else if (command === "retry-failed") {
      const jobId = z.string().uuid().parse(values.job);
      if (campaigns[0]!.automation_mode !== "drafts") throw new Error("Diagnostic retries require drafts mode");
      await db.transaction(async (tx) => {
        const jobs = await tx.execute(sql`select j.id,j.last_error from lh_jobs j join lh_runs r on r.id=j.run_id and r.owner_id=j.owner_id where j.owner_id=${ownerId} and r.campaign_id=${campaignId} and j.id=${jobId} and j.state='failed' for update of j`);
        if (!jobs.length) throw new Error("Failed job not found in this campaign");
        await tx.execute(sql`insert into lh_activity (owner_id,campaign_id,actor_type,event_type,detail) values (${ownerId},${campaignId},'human','job.retry_requested',${JSON.stringify(jobs[0])}::jsonb)`);
        await tx.execute(sql`update lh_jobs set state='queued',attempt_count=0,last_error=null,lease_owner=null,lease_token_digest=null,lease_expires_at=null where owner_id=${ownerId} and id=${jobId}`);
        await tx.execute(sql`update lh_runs set state='running',finished_at=null where owner_id=${ownerId} and id=(select run_id from lh_jobs where owner_id=${ownerId} and id=${jobId})`);
      });
      console.log(JSON.stringify({ jobId, retried: true, sendsEnabled: false }));
    } else if (command === "enable-sending") {
      const mailbox = z.string().uuid().parse(values.mailbox);
      await db.transaction(async (tx) => {
        const configured = await tx.execute(sql`select id from lh_campaigns where owner_id=${ownerId} and mailbox_id=${mailbox} limit 1`);
        if (!configured.length) throw new Error("Mailbox must be an existing configured mailbox for this owner");
        await tx.execute(sql`update lh_campaigns set automation_mode='automatic',mailbox_id=${mailbox} where owner_id=${ownerId} and id=${campaignId} and status<>'archived'`);
      });
      console.log("Sending configured. Use run only after authorizing live outreach.");
    } else {
      await db.transaction(async (tx) => {
        await controlCampaign(tx, { ownerId, campaignId, command: command === "run" ? "run_now" : "pause" });
        if (command === "run" && !values.recurring) {
          await planDueRuns(tx, { now: new Date(), campaignId, ownerId });
          await tx.execute(sql`update lh_campaigns set next_search_at=null where owner_id=${ownerId} and id=${campaignId}`);
        }
      });
      console.log(JSON.stringify({ campaignId, command, recurring: values.recurring, modePreserved: true }));
    }
  } finally { await client.end(); }
}

main().catch((error: unknown) => {
  // Do not print connection details or SQL parameters from database errors.
  console.error(error instanceof z.ZodError ? z.prettifyError(error) : error instanceof Error ? error.message : "LeadHunter command failed");
  process.exitCode = 1;
});
