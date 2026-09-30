import "server-only";

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import * as schema from "@/db/schema";
import {
  leadHunterCampaigns,
  leadHunterCampaignVersions,
  leadHunterJobs,
  leadHunterRuns,
  type LeadHunterCampaignSnapshot,
} from "@/db/schema";
import { createSearchPlan } from "@/lib/leadhunter/search-planner";
import type {
  SearchPlanningCursor,
  SourceQueryCursor,
} from "@/lib/leadhunter/sources/contracts";

export type LeadHunterRunDatabase = Pick<
  PostgresJsDatabase<typeof schema>,
  "execute"
>;

interface DueCampaign {
  ownerId: string;
  campaignId: string;
  campaignVersion: number;
  scheduledFor: Date | string;
  snapshot: LeadHunterCampaignSnapshot;
}

interface CreatedRun {
  id: string;
}

interface PreviousRun {
  cursor: {
    planningCursor?: SearchPlanningCursor;
    previousCursors?: SourceQueryCursor[];
  };
}

export interface PlanDueRunsOptions {
  now: Date;
  maximumQueriesPerRun?: number;
}

export interface PlanDueRunsResult {
  dueCampaigns: number;
  createdRuns: number;
  createdJobs: number;
}

function boundedQueryCount(snapshot: LeadHunterCampaignSnapshot, maximum: number) {
  return Math.max(0, Math.min(snapshot.dailyLeadLimit, maximum));
}

const weekdayNames = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

interface LocalDateTimeParts {
  day: number;
  hour: number;
  minute: number;
  month: number;
  year: number;
}

function databaseDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Database returned an invalid scheduled time");
  }
  return date;
}

function localParts(date: Date, timeZone: string): LocalDateTimeParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  });
  const values = Object.fromEntries(
    formatter.formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );

  return {
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
    month: values.month!,
    year: values.year!,
  };
}

function instantForLocalTime(
  desired: LocalDateTimeParts,
  timeZone: string,
): Date | undefined {
  let instant = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  );
  const desiredAsUtc = instant;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actual = localParts(new Date(instant), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const correction = desiredAsUtc - actualAsUtc;
    if (correction === 0) return new Date(instant);
    instant += correction;
  }

  return undefined;
}

function nextScheduledSearch(
  after: Date,
  schedule: LeadHunterCampaignSnapshot["schedule"],
) {
  const match = /^(\d{2}):(\d{2})$/.exec(schedule.searchTime);
  if (!match) throw new TypeError("Campaign search time is invalid");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const searchDays = new Set(schedule.searchDays.map((day) => day.toLowerCase()));
  const current = localParts(after, schedule.timezone);
  const currentCalendarDay = Date.UTC(
    current.year,
    current.month - 1,
    current.day,
  );

  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    const calendarDay = new Date(currentCalendarDay + dayOffset * 86_400_000);
    const weekday = weekdayNames[calendarDay.getUTCDay()]!;
    if (!searchDays.has(weekday)) continue;

    const candidate = instantForLocalTime({
      year: calendarDay.getUTCFullYear(),
      month: calendarDay.getUTCMonth() + 1,
      day: calendarDay.getUTCDate(),
      hour,
      minute,
    }, schedule.timezone);
    if (candidate && candidate.getTime() > after.getTime()) return candidate;
  }

  throw new RangeError("Campaign schedule has no future search slot");
}

export async function planDueRuns(
  database: LeadHunterRunDatabase,
  { now, maximumQueriesPerRun = 100 }: PlanDueRunsOptions,
): Promise<PlanDueRunsResult> {
  if (!Number.isSafeInteger(maximumQueriesPerRun) || maximumQueriesPerRun < 0) {
    throw new RangeError("maximumQueriesPerRun must be a non-negative integer");
  }

  const dueCampaigns = await database.execute(sql<DueCampaign>`
    select
      ${leadHunterCampaigns.ownerId} as "ownerId",
      ${leadHunterCampaigns.id} as "campaignId",
      ${leadHunterCampaigns.configVersion} as "campaignVersion",
      ${leadHunterCampaigns.nextSearchAt} as "scheduledFor",
      ${leadHunterCampaignVersions.snapshot} as "snapshot"
    from ${leadHunterCampaigns}
    inner join ${leadHunterCampaignVersions}
      on ${leadHunterCampaignVersions.ownerId} = ${leadHunterCampaigns.ownerId}
     and ${leadHunterCampaignVersions.campaignId} = ${leadHunterCampaigns.id}
     and ${leadHunterCampaignVersions.version} = ${leadHunterCampaigns.configVersion}
    where ${leadHunterCampaigns.status} = 'active'
      and ${leadHunterCampaigns.nextSearchAt} is not null
      and ${leadHunterCampaigns.nextSearchAt} <= ${now}
    order by ${leadHunterCampaigns.nextSearchAt}, ${leadHunterCampaigns.id}
    for update of ${leadHunterCampaigns} skip locked
  `) as unknown as DueCampaign[];

  let createdRuns = 0;
  let createdJobs = 0;

  for (const campaign of dueCampaigns) {
    const scheduledFor = databaseDate(campaign.scheduledFor);
    const previousRuns = await database.execute(sql<PreviousRun>`
      select ${leadHunterRuns.cursor}
      from ${leadHunterRuns}
      where ${leadHunterRuns.ownerId} = ${campaign.ownerId}
        and ${leadHunterRuns.campaignId} = ${campaign.campaignId}
        and ${leadHunterRuns.campaignVersion} = ${campaign.campaignVersion}
        and ${leadHunterRuns.scheduledFor} < ${scheduledFor}
      order by ${leadHunterRuns.scheduledFor} desc
      limit 1
    `) as unknown as PreviousRun[];
    const previousCursor = previousRuns[0]?.cursor;
    const previousCursors = previousCursor?.previousCursors ?? [];
    const plan = createSearchPlan({
      campaignVersion: campaign.campaignVersion,
      campaign: campaign.snapshot,
      maxQueries: boundedQueryCount(
        campaign.snapshot,
        maximumQueriesPerRun,
      ),
      planningCursor: previousCursor?.planningCursor ?? { offset: 0 },
      previousCursors,
    });
    const insertedRuns = await database.execute(sql<CreatedRun>`
      insert into ${leadHunterRuns} (
        owner_id,
        campaign_id,
        campaign_version,
        scheduled_for,
        plan,
        cursor,
        state
      ) values (
        ${campaign.ownerId},
        ${campaign.campaignId},
        ${campaign.campaignVersion},
        ${scheduledFor},
        ${JSON.stringify(plan)}::jsonb,
        ${JSON.stringify({
          planningCursor: plan.nextPlanningCursor,
          previousCursors,
        })}::jsonb,
        'planned'
      )
      on conflict (owner_id, campaign_id, campaign_version, scheduled_for)
        where ${leadHunterRuns.state} in ('planned', 'running')
      do nothing
      returning id
    `) as unknown as CreatedRun[];
    const run = insertedRuns[0];
    if (!run) continue;

    createdRuns += 1;
    if (plan.work.length > 0) {
      const jobValues = plan.work.map((work) => sql`(
        ${campaign.ownerId},
        ${run.id},
        'discover',
        ${JSON.stringify(work)}::jsonb,
        ${`run:${run.id}:discover:${work.id}`}
      )`);

      await database.execute(sql`
        insert into ${leadHunterJobs} (
          owner_id,
          run_id,
          kind,
          payload,
          idempotency_key
        ) values ${sql.join(jobValues, sql`, `)}
        on conflict (owner_id, idempotency_key) do nothing
      `);
      createdJobs += plan.work.length;
    } else {
      await database.execute(sql`
        update ${leadHunterRuns}
        set
          state = 'completed',
          counts = jsonb_build_object(
            'total', 0,
            'succeeded', 0,
            'failed', 0
          ),
          started_at = ${now},
          finished_at = ${now}
        where ${leadHunterRuns.id} = ${run.id}
          and ${leadHunterRuns.state} = 'planned'
      `);
    }

    await database.execute(sql`
      update ${leadHunterCampaigns}
      set
        last_run_at = ${scheduledFor},
        next_search_at = ${nextScheduledSearch(
          scheduledFor,
          campaign.snapshot.schedule,
        )}
      where ${leadHunterCampaigns.ownerId} = ${campaign.ownerId}
        and ${leadHunterCampaigns.id} = ${campaign.campaignId}
        and ${leadHunterCampaigns.nextSearchAt} = ${scheduledFor}
    `);
  }

  return {
    dueCampaigns: dueCampaigns.length,
    createdRuns,
    createdJobs,
  };
}
