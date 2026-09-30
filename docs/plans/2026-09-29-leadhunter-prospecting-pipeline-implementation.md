# LeadHunter Prospecting Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a durable LeadHunter pipeline that discovers businesses, creates an evidence-backed research dossier, qualifies contacts, composes and validates individualized outreach, and queues an immutable email for the ChatGPT mail bridge.

**Architecture:** KazeOS owns campaign rules, jobs, evidence, qualification, copy generation, scheduling, and state. Deterministic TypeScript services enforce identity, gates, traceability, and editorial rules; provider adapters and a separate Python extraction worker return structured observations. ChatGPT is outside this plan's decision path and will later consume only validated outbox records and return mail events.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Zod 4, Drizzle ORM/PostgreSQL, Supabase Auth/RLS, Vitest, Playwright, Python 3.12, optional ScrapeGraphAI evaluation worker.

---

## Preconditions and execution rules

- Start from commit `b5bd228`, which contains the LeadHunter foundation and the approved design in `docs/plans/2026-09-29-leadhunter-prospecting-flow-design.md`.
- Apply `@test-driven-development` for every behavior change, `@supabase` and `@supabase-postgres-best-practices` for schema/RLS/lease work, and `@verification-before-completion` before each completion claim.
- Do not create the historical Argentina or United States campaigns. Their pasted prompts are acceptance references only.
- Do not run migrations or integration tests against the database loaded implicitly from the main checkout. Require an explicit isolated `TEST_DATABASE_URL` before any database mutation.
- Do not add a live source until its adapter can report capabilities, limits, cursor behavior, and evidence URLs. A disabled adapter must be visible as unavailable rather than silently returning no results.
- The ChatGPT email bridge is a separate plan. This plan ends with an immutable, validated outbox item and a narrow transport contract.

### Task 1: Add structured campaign strategy contracts

**Files:**
- Create: `src/lib/leadhunter/contracts.ts`
- Create: `src/lib/leadhunter/contracts.test.ts`
- Modify: `src/lib/validations/leadhunter.ts`
- Modify: `src/lib/validations/leadhunter.test.ts`
- Modify: `src/db/schema/leadhunter.ts`
- Modify: `src/lib/services/leadhunter/campaign-manager.ts`
- Modify: `src/lib/services/leadhunter/campaign-manager.test.ts`

**Step 1: Write failing contract tests**

Add cases that prove:

```ts
expect(campaignStrategySchema.parse(validStrategy)).toMatchObject({
  discovery: { countries: ["AR"], sources: ["web_search"] },
  qualification: { gates: [{ type: "website", allowed: ["NO_WEBSITE", "BAD_WEBSITE"] }] },
  message: { language: "es-AR", minimumSpecificFacts: 3 },
});

expect(() => campaignStrategySchema.parse({
  ...validStrategy,
  message: { ...validStrategy.message, minimumSpecificFacts: 0 },
})).toThrow();
```

Cover duplicate questions, unsupported locale tags, blank restricted phrases, gates without allowed states, and a message policy without CTA/signature.

**Step 2: Run the tests and verify the red state**

Run:

```powershell
pnpm exec vitest run src/lib/leadhunter/contracts.test.ts src/lib/validations/leadhunter.test.ts
```

Expected: FAIL because `campaignStrategySchema` and the structured fields do not exist.

**Step 3: Add the contracts**

Define and export schemas/types for:

```ts
type DiscoveryStrategy = {
  countries: string[];
  regions: string[];
  industries: string[];
  queries: string[];
  sources: LeadHunterSource[];
  seedUrls: string[];
};

type ResearchQuestion = {
  key: string;
  prompt: string;
  required: boolean;
};

type QualificationGate =
  | { type: "website"; allowed: WebsiteGateState[] }
  | { type: "required_finding"; field: string; minimumConfidence: number };

type MessagePolicy = {
  language: string;
  tone: string;
  minimumSpecificFacts: number;
  wordRange: { minimum: number; maximum: number };
  intro: string;
  commercialModel: string;
  cta: string;
  signature: string;
  requiredSections: MessageSection[];
  restrictedPhrases: string[];
};
```

Keep `positiveCriteria` and `negativeCriteria` for the current UI, but map them into weighted structured rules inside the snapshot. Add the new strategy object to `LeadHunterCampaignSnapshot` and persist it in `createCampaign`. Do not add historical campaign records.

**Step 4: Run focused tests**

Run the command from Step 2.

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/lib/leadhunter src/lib/validations/leadhunter.ts src/lib/validations/leadhunter.test.ts src/db/schema/leadhunter.ts src/lib/services/leadhunter
git commit -m "feat: define LeadHunter prospecting strategy"
```

### Task 2: Add durable pipeline storage and RLS

**Files:**
- Modify: `src/db/schema/leadhunter.ts`
- Modify: `src/db/schema/index.ts`
- Modify: `src/db/schema/leadhunter-schema.test.ts`
- Modify: `src/db/schema/leadhunter-migration.test.ts`
- Create: `supabase/migrations/0010_add_leadhunter_pipeline.sql`
- Create: `supabase/migrations/meta/0010_snapshot.json`
- Modify: `supabase/migrations/meta/_journal.json`

**Step 1: Write failing schema expectations**

Require exports and SQL objects for:

- `lh_runs`: campaign/version, plan JSON, cursor JSON, state, counts, started/finished timestamps.
- `lh_jobs`: run, enrollment/lead when applicable, job kind, state, payload/result, attempt count, lease owner/expiry, idempotency key and last error.
- `lh_source_candidates`: raw discovery record, source identity, query, canonical URL, resolution state and linked lead.
- `lh_website_audits`: gate result, checks, summary, confidence and evidence references.
- `lh_message_briefs`: immutable evidence-backed brief for one enrollment and campaign version.
- `lh_message_versions`: subject/body, validation result, model metadata and supersession state.
- `lh_outbox`: immutable transport command with recipient, exact subject/body, due time, logical step and idempotency key.

Extend:

- `lh_contacts` with `emailConfidence`, `sourceType`, `isPrimary` and `verifiedAt`.
- `lh_enrollments` with `qualificationDetail`, `researchSummary` and `messageVersionId`.
- `lh_evidence` with optional `runId`, `campaignId`, `extract` and `contentHash`.

Test owner-scoped composite foreign keys, unique job/outbox idempotency keys, score/confidence checks, indexes for claimable jobs and due outbox rows, and backend-only writes.

**Step 2: Verify schema tests fail**

```powershell
pnpm exec vitest run src/db/schema/leadhunter-schema.test.ts src/db/schema/leadhunter-migration.test.ts
```

Expected: FAIL for missing pipeline tables and migration statements.

**Step 3: Implement schema and migration**

Use explicit enums:

```ts
run: "planned" | "running" | "completed" | "partial" | "failed" | "cancelled"
job: "queued" | "leased" | "succeeded" | "failed" | "cancelled"
jobKind: "discover" | "resolve_identity" | "research" | "audit_website" |
  "qualify" | "enrich_contact" | "prepare_message" | "validate_message"
message: "draft" | "valid" | "invalid" | "superseded"
outbox: "queued" | "leased" | "provider_accepted" | "failed" | "unknown" | "cancelled"
```

`lh_outbox.subject` and `lh_outbox.body` are copied from the validated message version and cannot be changed after insert. Direct `authenticated` writes remain revoked; `kazeos_backend` writes through owner-scoped transactions.

Generate or hand-author the migration only after confirming the existing Drizzle journal order. Do not apply it without an isolated database URL.

**Step 4: Run schema tests and static checks**

```powershell
pnpm exec vitest run src/db/schema/leadhunter-schema.test.ts src/db/schema/leadhunter-migration.test.ts
pnpm typecheck
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/db/schema supabase/migrations
git commit -m "feat: add LeadHunter pipeline storage"
```

### Task 3: Generate a bounded search plan per run

**Files:**
- Create: `src/lib/leadhunter/search-planner.ts`
- Create: `src/lib/leadhunter/search-planner.test.ts`
- Create: `src/lib/leadhunter/sources/contracts.ts`

**Step 1: Write failing planner tests**

Use a fixed campaign snapshot and assert that the planner:

- creates source/country/industry query combinations without duplicates;
- respects a maximum query budget;
- carries the previous cursor;
- keeps user seed URLs separate from generated searches;
- never treats language as proof of geography.

Example assertion:

```ts
expect(plan.work).toEqual([
  expect.objectContaining({ source: "web_search", country: "AR", cursor: null }),
  expect.objectContaining({ source: "directories", country: "AR", cursor: "page:2" }),
]);
expect(plan.budget.maxCandidates).toBe(30);
```

**Step 2: Confirm failure**

```powershell
pnpm exec vitest run src/lib/leadhunter/search-planner.test.ts
```

Expected: FAIL because the planner is missing.

**Step 3: Implement the pure planner**

The planner returns serializable work items only. It does not call the network or an LLM. Normalize whitespace/case for deduplication while preserving the display query. Include the campaign version and a deterministic plan hash.

**Step 4: Run the test**

Expected: PASS.

**Step 5: Commit**

```powershell
git add src/lib/leadhunter/search-planner.ts src/lib/leadhunter/search-planner.test.ts src/lib/leadhunter/sources/contracts.ts
git commit -m "feat: plan bounded LeadHunter searches"
```

### Task 4: Implement durable runs, leasing and worker authentication

**Files:**
- Create: `src/lib/services/leadhunter/run-manager.ts`
- Create: `src/lib/services/leadhunter/run-manager.test.ts`
- Create: `src/lib/services/leadhunter/job-manager.ts`
- Create: `src/lib/services/leadhunter/job-manager.integration.test.ts`
- Create: `src/lib/leadhunter/worker-auth.ts`
- Create: `src/lib/leadhunter/worker-auth.test.ts`
- Create: `src/app/api/internal/leadhunter/jobs/next/route.ts`
- Create: `src/app/api/internal/leadhunter/jobs/next/route.test.ts`
- Create: `src/app/api/internal/leadhunter/jobs/[id]/complete/route.ts`
- Create: `src/app/api/internal/leadhunter/jobs/[id]/complete/route.test.ts`
- Create: `src/app/api/cron/leadhunter/route.ts`
- Create: `src/app/api/cron/leadhunter/route.test.ts`
- Modify: `src/lib/env.ts`
- Modify: `src/lib/env.test.ts`
- Modify: `src/lib/supabase/proxy.ts`
- Modify: `src/lib/supabase/proxy.test.ts`

**Step 1: Write failing state-machine and authentication tests**

Cover:

- one active run per campaign/version/slot;
- atomic `queued -> leased` claim using `FOR UPDATE SKIP LOCKED`;
- lease expiry and bounded retry;
- a duplicate completion request returning the stored result;
- failure of near-match bearer tokens;
- exact proxy exceptions only for the cron and two internal worker routes;
- no secret values in error responses or logs.

**Step 2: Run unit tests first**

```powershell
pnpm exec vitest run src/lib/services/leadhunter/run-manager.test.ts src/lib/leadhunter/worker-auth.test.ts src/app/api/internal/leadhunter/jobs/next/route.test.ts src/app/api/internal/leadhunter/jobs/\[id\]/complete/route.test.ts src/app/api/cron/leadhunter/route.test.ts src/lib/env.test.ts src/lib/supabase/proxy.test.ts
```

Expected: FAIL for missing services/routes.

**Step 3: Implement the manager and narrow routes**

Add `LEADHUNTER_WORKER_SECRET` to the server environment. Reuse constant-time bearer comparison behavior from `src/app/api/cron/generate-charges/route.ts`, but do not reuse `CRON_SECRET` for workers.

Claim response shape:

```ts
type ClaimedJob = {
  id: string;
  kind: LeadHunterJobKind;
  leaseToken: string;
  leaseExpiresAt: string;
  payload: unknown;
};
```

Completion must check job ID, lease token, current lease state and payload schema for the job kind. The worker never supplies a trusted `ownerId`; the server derives ownership from the claimed row.

**Step 4: Run integration test only with explicit isolation**

If `TEST_DATABASE_URL` is absent, leave the integration test skipped with an explicit message. The test URL must identify an isolated test database, resolve to a different canonical host/port/database target than `DATABASE_URL`, and be accompanied by the explicit mutation opt-in. The test connects directly with `TEST_DATABASE_URL`; do not replace `DATABASE_URL`:

```powershell
$env:LEADHUNTER_TEST_DATABASE_CONFIRM="leadhunter-test-only"
pnpm exec vitest run src/lib/services/leadhunter/job-manager.integration.test.ts
```

Expected: PASS and no mutation outside the isolated database.

**Step 5: Run focused unit tests and commit**

```powershell
pnpm exec vitest run src/lib/services/leadhunter/run-manager.test.ts src/lib/leadhunter/worker-auth.test.ts src/app/api/internal/leadhunter/jobs/next/route.test.ts src/app/api/internal/leadhunter/jobs/\[id\]/complete/route.test.ts src/app/api/cron/leadhunter/route.test.ts src/lib/env.test.ts src/lib/supabase/proxy.test.ts
git add src/lib/services/leadhunter src/lib/leadhunter src/app/api src/lib/env.ts src/lib/env.test.ts src/lib/supabase
git commit -m "feat: run durable LeadHunter jobs"
```

### Task 5: Add safe source adapters and candidate normalization

**Files:**
- Create: `src/lib/leadhunter/sources/registry.ts`
- Create: `src/lib/leadhunter/sources/registry.test.ts`
- Create: `src/lib/leadhunter/sources/searxng.ts`
- Create: `src/lib/leadhunter/sources/searxng.test.ts`
- Create: `src/lib/leadhunter/sources/seed-urls.ts`
- Create: `src/lib/leadhunter/sources/seed-urls.test.ts`
- Create: `src/lib/leadhunter/safe-url.ts`
- Create: `src/lib/leadhunter/safe-url.test.ts`
- Create: `src/lib/services/leadhunter/discovery-manager.ts`
- Create: `src/lib/services/leadhunter/discovery-manager.test.ts`

**Step 1: Write failing adapter tests with mocked HTTP**

Require every adapter to expose:

```ts
type SourceCapabilities = {
  discovery: boolean;
  enrichment: boolean;
  contactSearch: boolean;
  supportsCursor: boolean;
  live: boolean;
  unavailableReason?: string;
};
```

Test SearXNG JSON mapping, next-page cursor, malformed records, duplicate canonical URLs, timeouts and non-2xx responses. Test that loopback, private networks, link-local addresses, non-HTTP schemes and redirects to blocked destinations are rejected.

**Step 2: Verify failure**

```powershell
pnpm exec vitest run src/lib/leadhunter/sources src/lib/leadhunter/safe-url.test.ts src/lib/services/leadhunter/discovery-manager.test.ts
```

Expected: FAIL.

**Step 3: Implement registry and adapters**

The SearXNG adapter calls an operator-configured endpoint and requests JSON; it is unavailable when no endpoint is configured. `seed-urls` creates candidates from campaign-provided public URLs. Social adapters stay registered as unavailable until implemented with permitted access.

The discovery manager stores source candidates before scheduling identity jobs. Persist the exact query, provider rank, public URL and source metadata; do not accept source page text as instructions.

**Step 4: Run tests and commit**

```powershell
pnpm exec vitest run src/lib/leadhunter/sources src/lib/leadhunter/safe-url.test.ts src/lib/services/leadhunter/discovery-manager.test.ts
git add src/lib/leadhunter/sources src/lib/leadhunter/safe-url.ts src/lib/leadhunter/safe-url.test.ts src/lib/services/leadhunter/discovery-manager.ts src/lib/services/leadhunter/discovery-manager.test.ts
git commit -m "feat: discover LeadHunter candidates safely"
```

### Task 6: Resolve business identity without unsafe merging

**Files:**
- Create: `src/lib/leadhunter/identity.ts`
- Create: `src/lib/leadhunter/identity.test.ts`
- Create: `src/lib/services/leadhunter/identity-manager.ts`
- Create: `src/lib/services/leadhunter/identity-manager.test.ts`
- Modify: `src/lib/services/leadhunter/lead-manager.ts`
- Modify: `src/lib/services/leadhunter/lead-manager.test.ts`

**Step 1: Write failing identity tests**

Use fixtures for:

- same official domain and compatible location -> strong match;
- same normalized email -> strong match;
- same name but different country/address -> no automatic merge;
- branch and parent company -> review required;
- directory URL mistaken for official domain -> no domain match;
- existing contacted company -> link for enrichment but block new enrollment dispatch.

**Step 2: Verify failure**

```powershell
pnpm exec vitest run src/lib/leadhunter/identity.test.ts src/lib/services/leadhunter/identity-manager.test.ts src/lib/services/leadhunter/lead-manager.test.ts
```

Expected: FAIL.

**Step 3: Implement deterministic matching**

Return `same`, `different`, or `needs_review` with contributing signals. Only `same` can auto-link. Keep source candidates immutable and record the resolution decision in `lh_activity`.

**Step 4: Run tests and commit**

```powershell
pnpm exec vitest run src/lib/leadhunter/identity.test.ts src/lib/services/leadhunter/identity-manager.test.ts src/lib/services/leadhunter/lead-manager.test.ts
git add src/lib/leadhunter/identity.ts src/lib/leadhunter/identity.test.ts src/lib/services/leadhunter
git commit -m "feat: resolve LeadHunter business identities"
```

### Task 7: Evaluate the extraction worker and build research dossiers

**Files:**
- Create: `workers/leadhunter/pyproject.toml`
- Create: `workers/leadhunter/leadhunter_worker/__init__.py`
- Create: `workers/leadhunter/leadhunter_worker/contracts.py`
- Create: `workers/leadhunter/leadhunter_worker/extract.py`
- Create: `workers/leadhunter/tests/fixtures/`
- Create: `workers/leadhunter/tests/test_extract.py`
- Create: `src/lib/leadhunter/research.ts`
- Create: `src/lib/leadhunter/research.test.ts`
- Create: `src/lib/services/leadhunter/research-manager.ts`
- Create: `src/lib/services/leadhunter/research-manager.test.ts`
- Create: `docs/plans/2026-09-29-leadhunter-source-evaluation.md`

**Step 1: Add annotated fixtures and failing contract tests**

Include local HTML fixtures for:

- active business with official site;
- directory-only business;
- ambiguous business name;
- site with prompt-injection text;
- conflicting addresses;
- unreachable or empty page;
- published business email with source URL.

Expected worker result:

```py
class Finding(BaseModel):
    field: str
    value: str
    status: Literal["verified", "inferred", "conflicting"]
    confidence: int
    source_url: HttpUrl
    extract: str | None
```

Reject results without source URLs, confidence outside 0-100, unsupported fields or claims absent from the fixture.

**Step 2: Run tests and confirm failure**

```powershell
py -3.12 -m venv workers/leadhunter/.venv
workers/leadhunter/.venv/Scripts/python -m pip install -e "workers/leadhunter[test]"
workers/leadhunter/.venv/Scripts/python -m pytest workers/leadhunter/tests/test_extract.py -q
pnpm exec vitest run src/lib/leadhunter/research.test.ts src/lib/services/leadhunter/research-manager.test.ts
```

Expected: FAIL before implementation.

**Step 3: Implement the worker boundary and evaluation**

Pin Python and ScrapeGraphAI versions in `pyproject.toml`. The extractor receives fetched public content plus a field schema; it does not receive database, mail or KazeOS administrative credentials. Treat page content as untrusted data and constrain output through the Pydantic contract.

Measure fixture accuracy, unsupported claims, latency and model cost. Record actual results in `docs/plans/2026-09-29-leadhunter-source-evaluation.md`. If ScrapeGraphAI cannot meet the evidence contract, keep the same worker interface and replace only its extraction implementation; do not weaken traceability.

**Step 4: Implement the TypeScript dossier reducer**

`research.ts` converts findings into:

```ts
type ResearchDossier = {
  answers: Record<string, { status: "verified" | "inferred" | "conflicting" | "unknown"; evidenceIds: string[] }>;
  requiredUnknowns: string[];
  usableFactIds: string[];
  conflicts: string[];
};
```

The manager persists accepted findings, rejected-output diagnostics and activity. Missing answers become `unknown`; they are not stored as fake evidence rows.

**Step 5: Run tests and commit**

```powershell
workers/leadhunter/.venv/Scripts/python -m pytest workers/leadhunter/tests/test_extract.py -q
pnpm exec vitest run src/lib/leadhunter/research.test.ts src/lib/services/leadhunter/research-manager.test.ts
git add workers/leadhunter src/lib/leadhunter/research.ts src/lib/leadhunter/research.test.ts src/lib/services/leadhunter/research-manager.ts src/lib/services/leadhunter/research-manager.test.ts docs/plans/2026-09-29-leadhunter-source-evaluation.md
git commit -m "feat: build evidence-backed prospect research"
```

### Task 8: Implement optional website audit and qualification

**Files:**
- Create: `src/lib/leadhunter/website-audit.ts`
- Create: `src/lib/leadhunter/website-audit.test.ts`
- Create: `src/lib/leadhunter/qualification.ts`
- Create: `src/lib/leadhunter/qualification.test.ts`
- Create: `src/lib/services/leadhunter/qualification-manager.ts`
- Create: `src/lib/services/leadhunter/qualification-manager.test.ts`

**Step 1: Write failing cases from the historical workflow**

Cover:

- no official site plus verified active commercial presence -> `NO_WEBSITE`;
- broken pages plus incomplete content -> `BAD_WEBSITE`;
- old copyright alone -> `UNVERIFIED`, not bad;
- WordPress alone -> `UNVERIFIED`, not bad;
- usable modern site -> `GOOD_ENOUGH_WEBSITE`;
- required website gate rejects good-enough sites;
- campaign without website gate may still qualify the same business for automation;
- exclusion always beats a high score;
- no email results in `no_email`, not commercial rejection;
- missing required evidence results in `needs_review`.

**Step 2: Verify failure**

```powershell
pnpm exec vitest run src/lib/leadhunter/website-audit.test.ts src/lib/leadhunter/qualification.test.ts src/lib/services/leadhunter/qualification-manager.test.ts
```

Expected: FAIL.

**Step 3: Implement pure evaluators then persistence**

Keep these dimensions separate:

```ts
type QualificationResult = {
  decision: "eligible" | "excluded" | "needs_review" | "no_email";
  commercialFit: number;
  evidenceConfidence: number;
  businessStrength: number;
  contactability: number;
  score: number;
  gates: GateResult[];
  reasons: string[];
  evidenceIds: string[];
};
```

The manager updates enrollment state and writes the complete decision to activity. It must re-read the current campaign version before changing an enrollment.

**Step 4: Run tests and commit**

```powershell
pnpm exec vitest run src/lib/leadhunter/website-audit.test.ts src/lib/leadhunter/qualification.test.ts src/lib/services/leadhunter/qualification-manager.test.ts
git add src/lib/leadhunter/website-audit.ts src/lib/leadhunter/website-audit.test.ts src/lib/leadhunter/qualification.ts src/lib/leadhunter/qualification.test.ts src/lib/services/leadhunter/qualification-manager.ts src/lib/services/leadhunter/qualification-manager.test.ts
git commit -m "feat: qualify LeadHunter prospects with evidence"
```

### Task 9: Enrich and select public business contacts

**Files:**
- Create: `src/lib/leadhunter/contact-enrichment.ts`
- Create: `src/lib/leadhunter/contact-enrichment.test.ts`
- Create: `src/lib/services/leadhunter/contact-manager.ts`
- Create: `src/lib/services/leadhunter/contact-manager.test.ts`

**Step 1: Write failing tests**

Test:

- exact public address on official domain -> high confidence;
- exact address on strongly matched directory -> medium confidence;
- generated `info@domain` absent from sources -> rejected;
- person inferred from mailbox local part -> rejected;
- verified owner/role outranks generic contact when appropriate;
- conflicting people or emails -> review;
- otherwise eligible business without email remains visible and cannot queue mail.

**Step 2: Verify failure**

```powershell
pnpm exec vitest run src/lib/leadhunter/contact-enrichment.test.ts src/lib/services/leadhunter/contact-manager.test.ts
```

Expected: FAIL.

**Step 3: Implement contact selection**

The pure selector returns the chosen contact plus alternates and reasons. Persistence requires source URL for every automated email, normalizes the email only for comparison, and preserves the exact published address for display.

**Step 4: Run tests and commit**

```powershell
pnpm exec vitest run src/lib/leadhunter/contact-enrichment.test.ts src/lib/services/leadhunter/contact-manager.test.ts
git add src/lib/leadhunter/contact-enrichment.ts src/lib/leadhunter/contact-enrichment.test.ts src/lib/services/leadhunter/contact-manager.ts src/lib/services/leadhunter/contact-manager.test.ts
git commit -m "feat: enrich verified LeadHunter contacts"
```

### Task 10: Build evidence-backed message briefs

**Files:**
- Create: `src/lib/leadhunter/message-brief.ts`
- Create: `src/lib/leadhunter/message-brief.test.ts`
- Create: `src/lib/services/leadhunter/message-brief-manager.ts`
- Create: `src/lib/services/leadhunter/message-brief-manager.test.ts`

**Step 1: Write failing brief tests**

Require a brief to contain:

- selected contact and salutation basis;
- locale and signature;
- at least the configured number of usable facts with evidence IDs;
- one primary opportunity;
- zero or one secondary opportunity;
- allowed claims, uncertainty notes and prohibited claims;
- CTA and commercial-model text from the campaign version.

Fail when a fact belongs to another owner/lead, a required fact is inferred below the allowed confidence, or the enrollment is not eligible.

**Step 2: Verify failure**

```powershell
pnpm exec vitest run src/lib/leadhunter/message-brief.test.ts src/lib/services/leadhunter/message-brief-manager.test.ts
```

Expected: FAIL.

**Step 3: Implement immutable brief creation**

Store the exact campaign version, contact ID and evidence IDs. The brief builder may select from qualified evidence but may not generate new business facts.

**Step 4: Run tests and commit**

```powershell
pnpm exec vitest run src/lib/leadhunter/message-brief.test.ts src/lib/services/leadhunter/message-brief-manager.test.ts
git add src/lib/leadhunter/message-brief.ts src/lib/leadhunter/message-brief.test.ts src/lib/services/leadhunter/message-brief-manager.ts src/lib/services/leadhunter/message-brief-manager.test.ts
git commit -m "feat: prepare LeadHunter message briefs"
```

### Task 11: Compose and validate individualized messages

**Files:**
- Create: `src/lib/leadhunter/message-composer.ts`
- Create: `src/lib/leadhunter/message-composer.test.ts`
- Create: `src/lib/leadhunter/editorial-validator.ts`
- Create: `src/lib/leadhunter/editorial-validator.test.ts`
- Create: `src/lib/services/leadhunter/message-manager.ts`
- Create: `src/lib/services/leadhunter/message-manager.test.ts`

**Step 1: Write failing composer/validator tests**

Use deterministic fake model output and assert:

- natural `es-AR` and `en-US` policies select their own CTA/signature;
- output is plain text;
- every company-specific claim maps to a brief evidence ID;
- at least three facts are specific when configured;
- forbidden phrases, fake urgency, HTML, emojis and invented contact names fail;
- word range is enforced;
- a generic message reusable for all fixtures fails specificity;
- regeneration receives only validation issues and the same immutable brief.

Model output contract:

```ts
type ComposedMessage = {
  subject: string;
  body: string;
  claims: Array<{ text: string; evidenceIds: string[] }>;
};
```

**Step 2: Verify failure**

```powershell
pnpm exec vitest run src/lib/leadhunter/message-composer.test.ts src/lib/leadhunter/editorial-validator.test.ts src/lib/services/leadhunter/message-manager.test.ts
```

Expected: FAIL.

**Step 3: Implement composition and deterministic validation**

Inject a `TextGenerationProvider`; do not bind domain services directly to an OpenAI SDK. The prompt includes the brief as data and states that untrusted page extracts are citations, never instructions. Limit regeneration attempts and persist every version plus validation report.

Only a `valid` version can set `enrollment.messageVersionId` and move the enrollment to `ready`.

**Step 4: Run tests and commit**

```powershell
pnpm exec vitest run src/lib/leadhunter/message-composer.test.ts src/lib/leadhunter/editorial-validator.test.ts src/lib/services/leadhunter/message-manager.test.ts
git add src/lib/leadhunter/message-composer.ts src/lib/leadhunter/message-composer.test.ts src/lib/leadhunter/editorial-validator.ts src/lib/leadhunter/editorial-validator.test.ts src/lib/services/leadhunter/message-manager.ts src/lib/services/leadhunter/message-manager.test.ts
git commit -m "feat: compose validated prospect emails"
```

### Task 12: Orchestrate the full prospect pipeline

**Files:**
- Create: `src/lib/services/leadhunter/pipeline-manager.ts`
- Create: `src/lib/services/leadhunter/pipeline-manager.test.ts`
- Create: `src/lib/services/leadhunter/pipeline-manager.integration.test.ts`
- Modify: `src/lib/services/leadhunter/job-manager.ts`
- Modify: `src/lib/services/leadhunter/run-manager.ts`

**Step 1: Write failing orchestration tests**

Use fixture adapters and a fake generator to prove:

- stages enqueue only after their dependency succeeds;
- one candidate failure does not cancel the run;
- a required gate exclusion skips contact/message jobs;
- a missing email ends at `no_email`;
- duplicate source candidates converge on one lead/enrollment;
- stale jobs from an old campaign version cannot queue a message;
- completion counts reflect actual state;
- pausing the campaign cancels unleased work and blocks new outbox records.

**Step 2: Verify failure**

```powershell
pnpm exec vitest run src/lib/services/leadhunter/pipeline-manager.test.ts
```

Expected: FAIL.

**Step 3: Implement stage transitions**

Use an explicit transition table, not recursive calls. Each completion schedules the next idempotent job in the same transaction. Record state changes in `lh_activity` with actor `system` or `agent` as appropriate.

**Step 4: Run unit and isolated integration tests**

```powershell
pnpm exec vitest run src/lib/services/leadhunter/pipeline-manager.test.ts
$env:DATABASE_URL=$env:TEST_DATABASE_URL
pnpm exec vitest run src/lib/services/leadhunter/pipeline-manager.integration.test.ts
```

Expected: PASS when the isolated database is configured; otherwise report the integration test as unverified rather than falling back to `.env.local`.

**Step 5: Commit**

```powershell
git add src/lib/services/leadhunter
git commit -m "feat: orchestrate LeadHunter prospecting"
```

### Task 13: Queue immutable transport commands

**Files:**
- Create: `src/lib/leadhunter/outbox.ts`
- Create: `src/lib/leadhunter/outbox.test.ts`
- Create: `src/lib/services/leadhunter/outbox-manager.ts`
- Create: `src/lib/services/leadhunter/outbox-manager.integration.test.ts`
- Modify: `src/lib/services/leadhunter/pipeline-manager.ts`
- Modify: `src/lib/services/leadhunter/pipeline-manager.test.ts`

**Step 1: Write failing outbox tests**

Prove that:

- only valid message versions for an eligible enrollment can queue;
- subject/body are copied exactly;
- the same enrollment/sequence step cannot queue twice;
- recipient suppression, pause or stale campaign version blocks queueing;
- scheduling respects campaign window but contains no provider-specific logic;
- editing a message creates a new version and supersedes only an unleased outbox item.

**Step 2: Verify failure**

```powershell
pnpm exec vitest run src/lib/leadhunter/outbox.test.ts src/lib/services/leadhunter/pipeline-manager.test.ts
```

Expected: FAIL.

**Step 3: Implement the transport-neutral outbox**

Expose an internal service contract for the later ChatGPT bridge:

```ts
type MailTransportCommand = {
  outboxId: string;
  recipient: string;
  subject: string;
  body: string;
  dueAt: string;
  idempotencyKey: string;
};
```

The transport may acknowledge, fail or mark unknown, but cannot modify content or make campaign decisions.

**Step 4: Run tests and commit**

```powershell
pnpm exec vitest run src/lib/leadhunter/outbox.test.ts src/lib/services/leadhunter/pipeline-manager.test.ts
git add src/lib/leadhunter/outbox.ts src/lib/leadhunter/outbox.test.ts src/lib/services/leadhunter
git commit -m "feat: queue LeadHunter mail commands"
```

### Task 14: Add campaign strategy, run and dossier screens

**Files:**
- Modify: `src/components/leadhunter/campaign-form.tsx`
- Modify: `src/components/leadhunter/campaign-form.test.tsx`
- Create: `src/components/leadhunter/research-dossier.tsx`
- Create: `src/components/leadhunter/research-dossier.test.tsx`
- Create: `src/components/leadhunter/qualification-panel.tsx`
- Create: `src/components/leadhunter/qualification-panel.test.tsx`
- Create: `src/components/leadhunter/message-review.tsx`
- Create: `src/components/leadhunter/message-review.test.tsx`
- Create: `src/components/leadhunter/run-status.tsx`
- Create: `src/components/leadhunter/run-status.test.tsx`
- Modify: `src/app/(app)/leadhunter/campaigns/[id]/page.tsx`
- Modify: `src/app/(app)/leadhunter/campaigns/[id]/page.test.tsx`
- Modify: `src/app/(app)/leadhunter/leads/[id]/page.tsx`
- Modify: `src/app/(app)/leadhunter/leads/[id]/page.test.tsx`
- Modify: `src/lib/queries/leadhunter.ts`
- Create: `src/lib/queries/leadhunter-pipeline.test.ts`
- Modify: `src/app/globals.css`

**Step 1: Write failing component/page tests**

Require the UI to show plain-language sections for:

- where to search;
- what to investigate;
- mandatory gates and weighted signals;
- message language, CTA, signature and prohibited claims;
- current run counts by stage;
- evidence with source/confidence;
- website audit and unverified checks;
- qualification reasons;
- selected/alternate contacts and source;
- exact message version and validation failures;
- outbox state.

No screen should expose raw JSON or ask the owner to write a technical mega-prompt.

**Step 2: Verify failure**

```powershell
pnpm exec vitest run src/components/leadhunter src/app/\(app\)/leadhunter src/lib/queries/leadhunter-pipeline.test.ts
```

Expected: FAIL.

**Step 3: Implement accessible responsive views**

Reuse the existing KazeOS visual language and mobile patterns. Mark unavailable sources clearly. Provide `Buscar ahora`, `Pausar`, `Reintentar etapa` and `Excluir` actions only when the state transition is valid.

**Step 4: Run UI tests and commit**

```powershell
pnpm exec vitest run src/components/leadhunter src/app/\(app\)/leadhunter src/lib/queries/leadhunter-pipeline.test.ts
git add src/components/leadhunter src/app/\(app\)/leadhunter src/lib/queries/leadhunter.ts src/lib/queries/leadhunter-pipeline.test.ts src/app/globals.css
git commit -m "feat: show LeadHunter research workflow"
```

### Task 15: Add end-to-end fixture acceptance and final verification

**Files:**
- Create: `tests/e2e/leadhunter-prospecting.spec.ts`
- Create: `src/test/fixtures/leadhunter/argentina-no-website.json`
- Create: `src/test/fixtures/leadhunter/usa-bad-website.json`
- Create: `src/test/fixtures/leadhunter/good-website-automation.json`
- Modify: `docs/plans/2026-09-29-leadhunter-source-evaluation.md`

**Step 1: Write acceptance scenarios**

Use controlled fixtures only:

1. Argentina, active directory presence and no official website: qualifies under an optional website gate, finds a published email, produces Spanish copy with the configured signature and queues once.
2. United States, observably weak website: records concrete audit evidence, produces American English copy, excludes phone/WhatsApp, and queues once.
3. Good website plus observable manual wholesale workflow: rejected by a website-first campaign but eligible in a separate automation-focused fixture configuration.
4. Candidate with no verified email: remains qualified and visible but never queues.
5. Prompt-injection text in a source: remains evidence content and cannot change tools, rules or message policy.

**Step 2: Run directed verification**

```powershell
pnpm exec vitest run src/lib/leadhunter src/lib/services/leadhunter src/components/leadhunter src/app/\(app\)/leadhunter src/db/schema/leadhunter-schema.test.ts src/db/schema/leadhunter-migration.test.ts
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

Expected: all directed tests, typecheck, lint and build pass; diff check produces no output.

Run Playwright only against an isolated seeded environment:

```powershell
pnpm exec playwright test tests/e2e/leadhunter-prospecting.spec.ts
```

Expected: PASS, or explicitly document the missing isolated database/browser prerequisite without claiming E2E success.

Run Python verification:

```powershell
workers/leadhunter/.venv/Scripts/python -m pytest workers/leadhunter/tests -q
```

Expected: PASS.

**Step 3: Review the acceptance evidence**

Confirm manually that each queued message:

- contains only verified/in-scope claims;
- includes the configured number of company-specific details;
- records the exact email source;
- uses the correct locale, CTA and signature;
- can be traced from outbox to message version, brief and evidence;
- was not sent during this plan.

**Step 4: Commit final acceptance coverage**

```powershell
git add tests/e2e src/test/fixtures docs/plans/2026-09-29-leadhunter-source-evaluation.md
git commit -m "test: cover LeadHunter prospecting pipeline"
```

## Completion boundary

This plan is complete when a configured campaign can produce a validated, immutable outbox command from controlled and then approved live sources, with every decision visible in KazeOS. It does not create historical campaigns and does not send mail.

The next plan must implement the ChatGPT transport bridge with two independent automations: a scheduled dispatcher for due outbox commands and an inbound-email event task that forwards raw mail events to KazeOS. LeadHunter remains responsible for interpreting responses, pausing sequences and choosing subsequent content.
