import "server-only";

import {
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import * as schema from "@/db/schema";
import { leadHunterJobs, leadHunterRuns } from "@/db/schema";
import { leadHunterSourceSchema } from "@/lib/leadhunter/contracts";

type JobKind =
  | "discover"
  | "resolve_identity"
  | "research"
  | "audit_website"
  | "qualify"
  | "enrich_contact"
  | "prepare_message"
  | "validate_message";

function resultSchema<TKind extends JobKind, TOutput extends z.ZodType>(
  kind: TKind,
  output: TOutput,
) {
  return z.object({
    kind: z.literal(kind),
    output,
  }).strict();
}

const sourceResultCursorSchema = z.union([
  z.object({ state: z.literal("exhausted") }).strict(),
  z.object({
    state: z.literal("next"),
    value: z.json(),
  }).strict(),
]);

const sourceQueryPayloadSchema = z.object({
  kind: z.literal("source_query"),
  source: leadHunterSourceSchema,
  country: z.string().trim().min(1),
  region: z.string().nullable(),
  industry: z.string().nullable(),
  query: z.string().trim().min(1),
});

const jobResultSchemas = {
  discover: resultSchema("discover", z.object({
    candidateCount: z.number().int().nonnegative(),
    nextCursor: sourceResultCursorSchema.optional(),
  }).strict()),
  resolve_identity: resultSchema("resolve_identity", z.object({
    leadId: z.string().uuid().nullable(),
    confidence: z.number().min(0).max(1),
  }).strict()),
  research: resultSchema("research", z.object({
    evidenceIds: z.array(z.string().uuid()),
  }).strict()),
  audit_website: resultSchema("audit_website", z.object({
    auditId: z.string().uuid(),
  }).strict()),
  qualify: resultSchema("qualify", z.object({
    qualified: z.boolean(),
    score: z.number().min(0).max(100),
  }).strict()),
  enrich_contact: resultSchema("enrich_contact", z.object({
    contactIds: z.array(z.string().uuid()),
  }).strict()),
  prepare_message: resultSchema("prepare_message", z.object({
    messageVersionId: z.string().uuid(),
  }).strict()),
  validate_message: resultSchema("validate_message", z.object({
    valid: z.boolean(),
    issues: z.array(z.string().trim().min(1).max(500)),
  }).strict()),
};

type JobResult = z.infer<
  (typeof jobResultSchemas)[keyof typeof jobResultSchemas]
>;

export type LeadHunterJobDatabase = Pick<
  PostgresJsDatabase<typeof schema>,
  "execute"
>;

export interface ClaimedJob {
  id: string;
  kind: JobKind;
  leaseToken: string;
  leaseExpiresAt: string;
  payload: unknown;
}

interface ClaimedJobRow extends Omit<ClaimedJob, "leaseToken" | "leaseExpiresAt"> {
  runId: string;
  leaseExpiresAt: Date | string;
}

interface StoredJob {
  id: string;
  runId: string;
  kind: JobKind;
  state: "queued" | "leased" | "succeeded" | "failed" | "cancelled";
  result: JobResult | null;
  payload: Record<string, unknown>;
  attemptCount: number;
  leaseExpiresAt: Date | string | null;
  leaseTokenDigest: string | null;
}

interface ExpiredLeaseRow {
  runId: string;
  state: "queued" | "failed";
}

export interface ClaimNextJobOptions {
  now: Date;
  leaseDurationMs: number;
  maxAttempts: number;
}

export type JobCompletion =
  | { result: unknown }
  | { error: string };

export interface CompleteJobInput {
  id: string;
  leaseToken: string;
  completion: JobCompletion;
  now: Date;
  maxAttempts: number;
}

export type CompleteJobResult =
  | { status: "succeeded"; result: JobResult }
  | { status: "queued" | "failed"; result: null };

export class JobCompletionRejectedError extends Error {
  constructor() {
    super("Job completion rejected");
    this.name = "JobCompletionRejectedError";
  }
}

export class JobCompletionValidationError extends Error {
  constructor() {
    super("Invalid job result");
    this.name = "JobCompletionValidationError";
  }
}

function digestLeaseToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function databaseDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Database returned an invalid timestamp");
  }
  return date;
}

function exactDigestMatch(stored: string | null, actual: string) {
  if (stored === null) return false;
  const expectedBytes = Buffer.from(stored);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length
    && timingSafeEqual(expectedBytes, actualBytes);
}

function validateRuntimeOptions(options: ClaimNextJobOptions) {
  if (!Number.isSafeInteger(options.leaseDurationMs) || options.leaseDurationMs < 1) {
    throw new RangeError("leaseDurationMs must be a positive integer");
  }
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }
}

function safeLastError(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return (normalized || "Worker reported a failure").slice(0, 500);
}

async function settleRun(
  database: LeadHunterJobDatabase,
  runId: string,
  now: Date,
) {
  await database.execute(sql`
    update ${leadHunterRuns} as run
    set
      state = case
        when summary.failed_count = summary.total_count then 'failed'::lh_run_state
        when summary.failed_count > 0 then 'partial'::lh_run_state
        else 'completed'::lh_run_state
      end,
      counts = jsonb_build_object(
        'total', summary.total_count,
        'succeeded', summary.succeeded_count,
        'failed', summary.failed_count
      ),
      finished_at = ${now}
    from (
      select
        count(*)::integer as total_count,
        count(*) filter (where state = 'succeeded')::integer as succeeded_count,
        count(*) filter (where state = 'failed')::integer as failed_count,
        count(*) filter (where state in ('queued', 'leased'))::integer as active_count
      from ${leadHunterJobs}
      where run_id = ${runId}
    ) as summary
    where run.id = ${runId}
      and summary.total_count > 0
      and summary.active_count = 0
      and run.state in ('planned', 'running')
  `);
}

export async function claimNextJob(
  database: LeadHunterJobDatabase,
  options: ClaimNextJobOptions,
): Promise<ClaimedJob | null> {
  validateRuntimeOptions(options);

  const expiredLeases = await database.execute(sql<ExpiredLeaseRow>`
    update ${leadHunterJobs}
    set
      state = case
        when ${leadHunterJobs.attemptCount} >= ${options.maxAttempts}
          then 'failed'::lh_job_state
        else 'queued'::lh_job_state
      end,
      lease_owner = null,
      lease_token_digest = null,
      lease_expires_at = null,
      last_error = 'Lease expired'
    where ${leadHunterJobs.state} = 'leased'
      and ${leadHunterJobs.leaseExpiresAt} <= ${options.now}
    returning
      ${leadHunterJobs.runId} as "runId",
      ${leadHunterJobs.state}
  `) as unknown as ExpiredLeaseRow[];

  const failedRunIds = new Set(
    expiredLeases
      .filter(({ state }) => state === "failed")
      .map(({ runId }) => runId),
  );
  for (const failedRunId of failedRunIds) {
    await settleRun(database, failedRunId, options.now);
  }

  const leaseToken = randomBytes(32).toString("base64url");
  const leaseTokenDigest = digestLeaseToken(leaseToken);
  const leaseExpiresAt = new Date(
    options.now.getTime() + options.leaseDurationMs,
  );
  const rows = await database.execute(sql<ClaimedJobRow>`
    with candidate as (
      select ${leadHunterJobs.id}
      from ${leadHunterJobs}
      where ${leadHunterJobs.state} = 'queued'
        and ${leadHunterJobs.attemptCount} < ${options.maxAttempts}
      order by ${leadHunterJobs.createdAt}, ${leadHunterJobs.id}
      for update skip locked
      limit 1
    )
    update ${leadHunterJobs} as job
    set
      state = 'leased',
      attempt_count = job.attempt_count + 1,
      lease_owner = 'worker-api',
      lease_token_digest = ${leaseTokenDigest},
      lease_expires_at = ${leaseExpiresAt},
      last_error = null
    from candidate
    where job.id = candidate.id
    returning
      job.id,
      job.run_id as "runId",
      job.kind,
      job.lease_expires_at as "leaseExpiresAt",
      job.payload
  `) as unknown as ClaimedJobRow[];
  const claimed = rows[0];
  if (!claimed) return null;

  await database.execute(sql`
    update ${leadHunterRuns}
    set
      state = 'running',
      started_at = coalesce(${leadHunterRuns.startedAt}, ${options.now})
    where ${leadHunterRuns.id} = ${claimed.runId}
      and ${leadHunterRuns.state} = 'planned'
  `);

  return {
    id: claimed.id,
    kind: claimed.kind,
    leaseToken,
    leaseExpiresAt: databaseDate(claimed.leaseExpiresAt).toISOString(),
    payload: claimed.payload,
  };
}

export async function completeJob(
  database: LeadHunterJobDatabase,
  input: CompleteJobInput,
): Promise<CompleteJobResult> {
  if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1) {
    throw new RangeError("maxAttempts must be a positive integer");
  }

  const rows = await database.execute(sql<StoredJob>`
    select
      ${leadHunterJobs.id},
      ${leadHunterJobs.runId} as "runId",
      ${leadHunterJobs.kind},
      ${leadHunterJobs.state},
      ${leadHunterJobs.result},
      ${leadHunterJobs.payload},
      ${leadHunterJobs.attemptCount} as "attemptCount",
      ${leadHunterJobs.leaseExpiresAt} as "leaseExpiresAt",
      ${leadHunterJobs.leaseTokenDigest} as "leaseTokenDigest"
    from ${leadHunterJobs}
    where ${leadHunterJobs.id} = ${input.id}
    for update
  `) as unknown as StoredJob[];
  const job = rows[0];
  const suppliedDigest = digestLeaseToken(input.leaseToken);

  if (!job || !exactDigestMatch(job.leaseTokenDigest, suppliedDigest)) {
    throw new JobCompletionRejectedError();
  }

  if (job.state === "succeeded" && job.result) {
    return { status: "succeeded", result: job.result };
  }

  if (
    job.state !== "leased"
    || job.leaseExpiresAt === null
    || databaseDate(job.leaseExpiresAt).getTime() <= input.now.getTime()
  ) {
    throw new JobCompletionRejectedError();
  }

  if ("result" in input.completion) {
    const parsed = jobResultSchemas[job.kind].safeParse(input.completion.result);
    if (!parsed.success) throw new JobCompletionValidationError();

    await database.execute(sql`
      update ${leadHunterJobs}
      set
        state = 'succeeded',
        result = ${JSON.stringify(parsed.data)}::jsonb,
        lease_owner = null,
        lease_expires_at = null,
        last_error = null
      where ${leadHunterJobs.id} = ${job.id}
        and ${leadHunterJobs.state} = 'leased'
    `);
    if (parsed.data.kind === "discover" && parsed.data.output.nextCursor) {
      const sourceQuery = sourceQueryPayloadSchema.safeParse(job.payload);
      if (sourceQuery.success) {
        const sourceCursor = {
          source: sourceQuery.data.source,
          country: sourceQuery.data.country,
          region: sourceQuery.data.region,
          industry: sourceQuery.data.industry,
          query: sourceQuery.data.query,
          cursor: parsed.data.output.nextCursor,
        };
        await database.execute(sql`
          update ${leadHunterRuns}
          set cursor = jsonb_set(
            ${leadHunterRuns.cursor},
            '{previousCursors}',
            coalesce(
              ${leadHunterRuns.cursor}->'previousCursors',
              '[]'::jsonb
            ) || jsonb_build_array(${JSON.stringify(sourceCursor)}::jsonb),
            true
          )
          where ${leadHunterRuns.id} = ${job.runId}
        `);
      }
    }
    await settleRun(database, job.runId, input.now);
    return { status: "succeeded", result: parsed.data };
  }

  const nextState = job.attemptCount >= input.maxAttempts ? "failed" : "queued";
  await database.execute(sql`
    update ${leadHunterJobs}
    set
      state = ${nextState}::lh_job_state,
      lease_owner = null,
      lease_token_digest = null,
      lease_expires_at = null,
      last_error = ${safeLastError(input.completion.error)}
    where ${leadHunterJobs.id} = ${job.id}
      and ${leadHunterJobs.state} = 'leased'
  `);
  if (nextState === "failed") {
    await settleRun(database, job.runId, input.now);
  }

  return { status: nextState, result: null };
}
