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
import { contactEnrichmentPayloadSchema } from "@/lib/leadhunter/contact-enrichment";
import { leadHunterSourceSchema } from "@/lib/leadhunter/contracts";

export type JobKind =
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

const workerSourceCandidateSchema = z.object({
  sourceType: z.union([leadHunterSourceSchema, z.literal("seed_url")]),
  sourceIdentity: z.string().trim().min(1).max(2_048),
  sourceUrl: z.string().url().max(2_048).refine(
    (value) => /^https?:\/\//i.test(value),
    "Source URL must use HTTP(S)",
  ),
  observedUrl: z.string().url().max(2_048).refine(
    (value) => /^https?:\/\//i.test(value),
    "Observed URL must use HTTP(S)",
  ),
  canonicalUrl: z.string().url().max(2_048).refine(
    (value) => /^https?:\/\//i.test(value),
    "Canonical URL must use HTTP(S)",
  ),
  observedName: z.string().trim().min(1).max(500).nullable(),
  observedLocation: z.string().trim().min(1).max(500).nullable(),
  providerRank: z.number().int().min(1).max(1_000),
  metadata: z.record(z.string().max(100), z.json()),
}).strict();

export const workerDiscoveryOutputSchema = z.object({
  candidateCount: z.number().int().nonnegative().max(50),
  candidates: z.array(workerSourceCandidateSchema).max(50).optional(),
  nextCursor: sourceResultCursorSchema.optional(),
}).strict().refine(
  ({ candidateCount, candidates }) =>
    candidates === undefined || candidateCount === candidates.length,
  "Candidate count must match candidates",
);

const runnableSourceCursorSchema = z.union([
  z.object({ state: z.literal("initial") }).strict(),
  z.object({
    state: z.literal("next"),
    value: z.json(),
  }).strict(),
]);

const sourceQueryPayloadSchema = z.object({
  kind: z.literal("source_query"),
  id: z.string().trim().min(1).max(200),
  source: leadHunterSourceSchema,
  country: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(160).nullable(),
  industry: z.string().trim().min(1).max(160).nullable(),
  query: z.string().trim().min(1).max(500),
  cursor: runnableSourceCursorSchema,
  geographyEvidence: z.null(),
}).strict();

const seedUrlPayloadSchema = z.object({
  kind: z.literal("seed_url"),
  id: z.string().trim().min(1).max(200),
  url: z.string().url().max(2_048).refine(
    (value) => /^https?:\/\//i.test(value),
    "Seed URL must use HTTP(S)",
  ),
}).strict();

const discoverPayloadSchema = z.discriminatedUnion("kind", [
  sourceQueryPayloadSchema,
  seedUrlPayloadSchema,
]);
export const workerDiscoveryWorkSchema = discoverPayloadSchema;
const leadPayloadSchema = z.object({ leadId: z.string().uuid() }).strict();
const researchPayloadSchema = z.object({
  leadId: z.string().uuid(),
  sourceCandidateId: z.string().uuid().optional(),
  source: z.object({
    sourceUrl: z.string().url().max(2_048).refine(
      (value) => /^https?:\/\//i.test(value),
      "Source URL must use HTTP(S)",
    ).refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password;
    }, "Source URL must not contain credentials"),
    sourceType: z.string().trim().min(1).max(80),
    suppliedAt: z.string().datetime({ offset: true }),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict().optional(),
  budget: z.object({
    maxRuntimeMs: z.number().int().min(50).max(120_000),
    maxModelCalls: z.number().int().min(0).max(10),
    maxInputTokens: z.number().int().min(0).max(200_000),
    maxOutputTokens: z.number().int().min(0).max(20_000),
    maxCostUsd: z.number().min(0).max(100),
  }).strict().optional(),
  content: z.string().max(100_000).optional(),
  questions: z.array(z.object({ key: z.string(), prompt: z.string(), required: z.boolean() }).strict()).max(100).optional(),
}).strict();

const jobPayloadSchemas = {
  discover: discoverPayloadSchema,
  resolve_identity: z.object({ candidateId: z.string().uuid() }).strict(),
  research: researchPayloadSchema,
  audit_website: z.object({
    leadId: z.string().uuid(),
    website: z.string().url().max(2_048).refine(
      (value) => /^https?:\/\//i.test(value),
      "Website must use HTTP(S)",
    ).nullable().optional(),
    sourceUrl: z.string().url().max(2_048).optional(),
  }).strict(),
  qualify: leadPayloadSchema,
  enrich_contact: contactEnrichmentPayloadSchema,
  prepare_message: z.object({ enrollmentId: z.string().uuid() }).strict(),
  validate_message: z.object({ messageVersionId: z.string().uuid() }).strict(),
};

const jobResultSchemas = {
  discover: resultSchema("discover", workerDiscoveryOutputSchema),
  resolve_identity: resultSchema("resolve_identity", z.object({
    leadId: z.string().uuid().nullable(),
    confidence: z.number().min(0).max(1),
  }).strict()),
  research: resultSchema("research", z.object({
    evidenceIds: z.array(z.string().uuid()).max(50),
  }).strict()),
  audit_website: resultSchema("audit_website", z.object({
    auditId: z.string().uuid(),
    gateResult: z.enum([
      "NO_WEBSITE",
      "BAD_WEBSITE",
      "GOOD_ENOUGH_WEBSITE",
      "UNVERIFIED",
    ]),
  }).strict()),
  qualify: resultSchema("qualify", z.object({
    decision: z.enum(["eligible", "excluded", "needs_review", "no_email"]),
    score: z.number().int().min(0).max(100),
  }).strict()),
  enrich_contact: resultSchema("enrich_contact", z.object({
    outcome: z.enum(["selected", "needs_review", "no_email"]),
    contactIds: z.array(z.string().uuid()).max(50),
    primaryContactId: z.string().uuid().nullable(),
    outboundBlocked: z.boolean(),
  }).strict()),
  prepare_message: resultSchema("prepare_message", z.object({
    messageVersionId: z.string().uuid(),
  }).strict()),
  validate_message: resultSchema("validate_message", z.object({
    valid: z.boolean(),
    issues: z.array(z.string().trim().min(1).max(500)).max(100),
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
  ownerId?: string;
  runId?: string;
  kind: JobKind;
  leaseToken: string;
  leaseExpiresAt: string;
  payload: unknown;
}

interface ClaimedJobRow extends Omit<ClaimedJob, "leaseToken" | "leaseExpiresAt"> {
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
  kinds?: JobKind[];
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

export function digestLeaseToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function databaseDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Database returned an invalid timestamp");
  }
  return date;
}

export function exactDigestMatch(stored: string | null, actual: string) {
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

export async function settleLeadHunterRun(
  database: LeadHunterJobDatabase,
  runId: string,
  now: Date,
) {
  const nowTimestamp = now.toISOString();
  await database.execute(sql`
    select ${leadHunterRuns.id}
    from ${leadHunterRuns}
    where ${leadHunterRuns.id} = ${runId}
    for update
  `);
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
      finished_at = ${nowTimestamp}
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
  const nowTimestamp = options.now.toISOString();

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
      and ${leadHunterJobs.leaseExpiresAt} <= ${nowTimestamp}
    returning
      ${leadHunterJobs.runId} as "runId",
      ${leadHunterJobs.state}
  `) as unknown as ExpiredLeaseRow[];

  const failedRunIds = new Set(
    expiredLeases
      .filter(({ state }) => state === "failed")
      .map(({ runId }) => runId),
  );
  for (const failedRunId of [...failedRunIds].sort()) {
    await settleLeadHunterRun(database, failedRunId, options.now);
  }

  const leaseToken = randomBytes(32).toString("base64url");
  const leaseTokenDigest = digestLeaseToken(leaseToken);
  const leaseExpiresAt = new Date(
    options.now.getTime() + options.leaseDurationMs,
  );
  const leaseExpiresAtTimestamp = leaseExpiresAt.toISOString();
  const rows = await database.execute(sql<ClaimedJobRow>`
    with candidate as (
      select ${leadHunterJobs.id}
      from ${leadHunterJobs}
      where ${leadHunterJobs.state} = 'queued'
        and ${leadHunterJobs.attemptCount} < ${options.maxAttempts}
        ${options.kinds?.length ? sql`and ${leadHunterJobs.kind} in (${sql.join(options.kinds.map((kind) => sql`${kind}::lh_job_kind`), sql`, `)})` : sql``}
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
      lease_expires_at = ${leaseExpiresAtTimestamp},
      last_error = null
    from candidate
    where job.id = candidate.id
    returning
      job.id,
      job.owner_id as "ownerId",
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
      started_at = coalesce(${leadHunterRuns.startedAt}, ${nowTimestamp})
    where ${leadHunterRuns.id} = ${claimed.runId}
      and ${leadHunterRuns.state} = 'planned'
  `);

  return {
    id: claimed.id,
    ownerId: claimed.ownerId,
    runId: claimed.runId,
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

  if (
    "result" in input.completion
    && ["research", "audit_website", "qualify", "enrich_contact"].includes(job.kind)
  ) {
    throw new JobCompletionValidationError();
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

  const parsedPayload = jobPayloadSchemas[job.kind].safeParse(job.payload);
  if (!parsedPayload.success) throw new JobCompletionValidationError();

  if ("result" in input.completion) {
    const parsed = jobResultSchemas[job.kind].safeParse(input.completion.result);
    if (!parsed.success) throw new JobCompletionValidationError();

    if (parsed.data.kind === "discover") {
      const discoveryPayload = discoverPayloadSchema.safeParse(job.payload);
      if (!discoveryPayload.success) throw new JobCompletionValidationError();
      if (
        discoveryPayload.data.kind === "source_query"
        && !parsed.data.output.nextCursor
      ) {
        throw new JobCompletionValidationError();
      }
    }

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
    await settleLeadHunterRun(database, job.runId, input.now);
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
    await settleLeadHunterRun(database, job.runId, input.now);
  }

  return { status: nextState, result: null };
}
