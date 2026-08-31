# Client Management MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a production-quality local Next.js application backed by remote Supabase that manages clients, recurring services, charges, payments, tasks, notes, and daily financial metrics.

**Architecture:** Next.js App Router renders authenticated Server Components and delegates mutations to validated Server Actions. Supabase SSR owns cookie-based authentication, while Drizzle uses a server-only pooled PostgreSQL connection; domain services centralize financial status, balances, MRR, recurrence, and commercial-date rules.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, shadcn/ui, Lucide, Supabase Auth/PostgreSQL, Drizzle ORM/Kit, Zod, React Hook Form, Vitest, Testing Library, Playwright, pnpm.

---

## Global execution rules

- Use `@test-driven-development` for every feature or bug fix.
- Use `@systematic-debugging` for every failing test or unexpected runtime behavior.
- Use `@supabase` for schema, authentication, database, or Supabase configuration work.
- Use `@interface-design` before writing each UI component and preserve the approved visual direction.
- Use `@verification-before-completion` before claiming any task or the MVP is finished.
- Commit after every task. Do not include `.env.local`, credentials, or generated test artifacts.
- Store all commercial dates as PostgreSQL `date` values and ISO `YYYY-MM-DD` strings in application code.
- Store money as integer minor units to avoid floating-point arithmetic. Never aggregate different currencies.
- Do not add deployment configuration or publish to GitHub/Vercel during this local phase.

## Task 1: Create the Next.js foundation

**Files:**
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `postcss.config.mjs`
- Create: `eslint.config.mjs`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `public/.gitkeep`
- Create: `.gitignore`

**Step 1: Confirm the runtime**

Run:

```powershell
node --version
pnpm --version
```

Expected: Node.js 20.9 or newer and a working pnpm installation.

**Step 2: Create the package manifest**

Declare these scripts:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "db:seed": "tsx src/db/seed.ts"
  }
}
```

Add runtime dependencies with:

```powershell
pnpm add next@^16 react@^19 react-dom@^19 @supabase/ssr @supabase/supabase-js drizzle-orm postgres zod react-hook-form @hookform/resolvers next-themes lucide-react sonner date-fns clsx tailwind-merge class-variance-authority
```

Add development dependencies with:

```powershell
pnpm add -D typescript @types/node @types/react @types/react-dom tailwindcss @tailwindcss/postcss eslint eslint-config-next drizzle-kit dotenv tsx vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @playwright/test
```

**Step 3: Create the minimal application files**

Use a root layout with `lang="es"`, metadata, `globals.css`, and a root page that redirects to `/dashboard`:

```tsx
// src/app/page.tsx
import { redirect } from "next/navigation";

export default function HomePage() {
  redirect("/dashboard");
}
```

**Step 4: Verify the clean scaffold**

Run:

```powershell
pnpm typecheck
pnpm lint
pnpm build
```

Expected: all three commands exit successfully. `next build` must be run separately from lint because Next.js 16 no longer runs lint automatically.

**Step 5: Commit**

```powershell
git add package.json pnpm-lock.yaml next.config.ts tsconfig.json postcss.config.mjs eslint.config.mjs src public .gitignore
git commit -m "chore: initialize Next.js application"
```

## Task 2: Install the test harness and base utilities

**Files:**
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`
- Create: `playwright.config.ts`
- Create: `src/lib/utils.ts`
- Create: `src/lib/utils.test.ts`

**Step 1: Write a failing utility test**

```ts
// src/lib/utils.test.ts
import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges conflicting Tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});
```

**Step 2: Run the test and verify failure**

Run: `pnpm test -- src/lib/utils.test.ts`

Expected: FAIL because `src/lib/utils.ts` does not exist.

**Step 3: Implement the utility and harness**

```ts
// src/lib/utils.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

Configure Vitest with the `@/` alias, jsdom, and `src/test/setup.ts`. Configure Playwright to use `http://127.0.0.1:3000` and start `pnpm dev` automatically.

**Step 4: Run tests**

Run: `pnpm test -- src/lib/utils.test.ts`

Expected: PASS.

**Step 5: Commit**

```powershell
git add vitest.config.ts playwright.config.ts src/test src/lib
git commit -m "test: add unit and browser test harnesses"
```

## Task 3: Define environment validation and connect Supabase

**Prerequisite:** Ask the user for the remote Supabase project URL, publishable key, and pooled `DATABASE_URL`. Do not ask for or store credentials before this task. A secret/service key is unnecessary for the MVP unless a later verified use case requires it.

**Files:**
- Create: `.env.example`
- Create: `.env.local` (untracked, populated from user-provided values)
- Create: `src/lib/env.ts`
- Create: `src/lib/env.test.ts`
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/proxy.ts`
- Create: `src/proxy.ts`
- Create: `src/db/index.ts`
- Create: `drizzle.config.ts`

**Step 1: Write failing environment tests**

Test that missing or malformed values produce a readable validation error and valid values parse successfully:

```ts
expect(() => parseEnv({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
expect(parseEnv(validEnv).DATABASE_URL).toContain("postgresql://");
```

**Step 2: Verify failure**

Run: `pnpm test -- src/lib/env.test.ts`

Expected: FAIL because `parseEnv` is not implemented.

**Step 3: Implement validated environment access**

Required variables:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
DATABASE_URL=
CRON_SECRET=
```

Use a Zod schema with URL validation and non-empty secrets. Keep browser-safe values separate from server-only values.

**Step 4: Implement clients and session refresh**

- `client.ts`: `createBrowserClient` from `@supabase/ssr`.
- `server.ts`: `createServerClient` backed by `cookies()`.
- `proxy.ts`: refresh sessions and redirect unauthenticated users away from private routes.
- `src/proxy.ts`: apply the proxy to all routes except static assets.
- `src/db/index.ts`: use `postgres(process.env.DATABASE_URL!, { prepare: false })` and `drizzle`.

**Step 5: Verify environment and database connectivity**

Run:

```powershell
pnpm test -- src/lib/env.test.ts
pnpm typecheck
```

Expected: PASS. Then execute a temporary read-only `select now()` through Drizzle and confirm a valid timestamp; remove the temporary check afterward.

**Step 6: Commit without secrets**

```powershell
git add .env.example src/lib/env.ts src/lib/env.test.ts src/lib/supabase src/proxy.ts src/db/index.ts drizzle.config.ts
git commit -m "feat: connect Supabase and validate environment"
```

## Task 4: Build the database schema and first migration

**Files:**
- Create: `src/db/schema/enums.ts`
- Create: `src/db/schema/profiles.ts`
- Create: `src/db/schema/clients.ts`
- Create: `src/db/schema/services.ts`
- Create: `src/db/schema/charges.ts`
- Create: `src/db/schema/payments.ts`
- Create: `src/db/schema/tasks.ts`
- Create: `src/db/schema/client-notes.ts`
- Create: `src/db/schema/settings.ts`
- Create: `src/db/schema/index.ts`
- Create: `src/db/schema/schema.test.ts`
- Create: `supabase/migrations/*_initial_schema.sql`

**Step 1: Write schema contract tests**

Assert the expected exported tables, critical columns, UUID primary keys, and unique service-period constraint exist in Drizzle metadata.

```ts
expect(getTableName(clients)).toBe("clients");
expect(getTableName(charges)).toBe("charges");
```

**Step 2: Verify failure**

Run: `pnpm test -- src/db/schema/schema.test.ts`

Expected: FAIL because schema modules do not exist.

**Step 3: Implement enums and tables**

Use these core choices:

- Currency: `USD | ARS`.
- Client status: `active | paused | archived`.
- Billing type: `recurring | one_time`.
- Billing frequency: `monthly | quarterly | yearly | one_time`.
- Service status: `active | paused | cancelled`.
- Charge persisted state: `pending | partial | paid | cancelled`; `due_today` and `overdue` are derived.
- Task priority: `low | medium | high`.
- Task status: `pending | completed`.
- Money columns: `bigint(..., { mode: "number" })` named `amount_minor` and `amount_paid_minor`.
- Commercial date columns: `date(..., { mode: "string" })`.
- Timestamps: timezone-aware, default `now()`.
- `charges`: unique index on `(service_id, period_key)` when a service is present.

Reference `auth.users.id` from `profiles.id` through migration SQL if Drizzle cannot safely own the Supabase auth schema.

**Step 4: Generate and inspect the migration**

Run: `pnpm db:generate`

Expected: a new SQL migration under `supabase/migrations/`. Inspect it and ensure it does not attempt to create or modify Supabase-owned auth tables.

**Step 5: Apply and verify the migration**

Run: `pnpm db:migrate`

Expected: migration succeeds against the supplied Supabase database. Verify tables, indexes, and foreign keys with read-only catalog queries.

**Step 6: Run schema tests and commit**

```powershell
pnpm test -- src/db/schema/schema.test.ts
git add src/db/schema supabase/migrations
git commit -m "feat: add client management database schema"
```

## Task 5: Implement commercial dates and money formatting

**Files:**
- Create: `src/lib/domain/money.ts`
- Create: `src/lib/domain/money.test.ts`
- Create: `src/lib/domain/commercial-date.ts`
- Create: `src/lib/domain/commercial-date.test.ts`

**Step 1: Write failing tests**

Cover:

```ts
expect(formatMoney(125000, "USD")).toBe("USD 1.250,00");
expect(formatMoney(85000000, "ARS")).toMatch(/850\.000/);
expect(todayInBusinessZone(now)).toBe("2026-08-30");
expect(compareCommercialDates("2026-09-10", "2026-09-09")).toBeGreaterThan(0);
```

Set `now` near UTC midnight to prove `America/Argentina/Buenos_Aires` does not move the commercial date incorrectly.

**Step 2: Verify failure**

Run: `pnpm test -- src/lib/domain/money.test.ts src/lib/domain/commercial-date.test.ts`

Expected: FAIL because helpers do not exist.

**Step 3: Implement minimal helpers**

- Convert user-entered decimal strings to integer minor units without floating-point multiplication.
- Format with `Intl.NumberFormat("es-AR")` and currency-specific presentation.
- Convert instants to business dates only at system boundaries.
- Compare and add recurrence periods using ISO date strings.

**Step 4: Verify and commit**

```powershell
pnpm test -- src/lib/domain/money.test.ts src/lib/domain/commercial-date.test.ts
git add src/lib/domain
git commit -m "feat: add money and commercial date utilities"
```

## Task 6: Implement charge status, balances, and MRR

**Files:**
- Create: `src/lib/domain/charges.ts`
- Create: `src/lib/domain/charges.test.ts`
- Create: `src/lib/domain/mrr.ts`
- Create: `src/lib/domain/mrr.test.ts`

**Step 1: Write failing charge tests**

Cover pending, due today, overdue, partial, paid, overpaid, and cancelled precedence:

```ts
expect(getChargeStatus({ amountMinor: 50000, amountPaidMinor: 20000, dueDate: "2026-09-10" }, "2026-09-01")).toBe("partial");
expect(getChargeBalance(50000, 20000)).toBe(30000);
expect(getChargeStatus({ amountMinor: 50000, amountPaidMinor: 0, dueDate: "2026-08-29" }, "2026-08-30")).toBe("overdue");
```

**Step 2: Write failing MRR tests**

Verify inactive services are excluded, currencies stay separate, and quarterly/yearly services are normalized:

```ts
expect(calculateMrr(services)).toEqual({ USD: 60000, ARS: 85000000 });
```

**Step 3: Verify failure**

Run: `pnpm test -- src/lib/domain/charges.test.ts src/lib/domain/mrr.test.ts`

Expected: FAIL because domain functions do not exist.

**Step 4: Implement the domain functions**

Use pure functions with no React or database imports. Cancelled and paid states take precedence, partial follows any positive underpayment, and date-derived states apply only to unpaid balances.

**Step 5: Verify and commit**

```powershell
pnpm test -- src/lib/domain/charges.test.ts src/lib/domain/mrr.test.ts
git add src/lib/domain
git commit -m "feat: add financial calculation rules"
```

## Task 7: Implement idempotent recurring generation

**Files:**
- Create: `src/lib/domain/recurrence.ts`
- Create: `src/lib/domain/recurrence.test.ts`
- Create: `src/lib/services/charge-generator.ts`
- Create: `src/lib/services/charge-generator.integration.test.ts`
- Create: `src/app/api/cron/generate-charges/route.ts`

**Step 1: Write failing recurrence tests**

Cover month-end clamping, leap years, quarterly/yearly periods, service end dates, and a three-month horizon.

```ts
expect(nextDueDate("2026-01-31", "monthly")).toBe("2026-02-28");
expect(buildChargePeriods(service, "2026-08-30", 3)).toHaveLength(3);
```

**Step 2: Verify failure**

Run: `pnpm test -- src/lib/domain/recurrence.test.ts`

Expected: FAIL.

**Step 3: Implement pure recurrence generation**

Return charge candidates containing `periodKey`, due date, description, amount, and currency. Do not write to the database from the pure module.

**Step 4: Write a failing idempotency integration test**

Call the database service twice for one active service and assert the second call inserts zero duplicates.

**Step 5: Implement transactional persistence**

Use `insert(...).onConflictDoNothing()` against the unique `(serviceId, periodKey)` constraint. The cron route must require `Authorization: Bearer <CRON_SECRET>` and return inserted/skipped counts.

**Step 6: Verify and commit**

```powershell
pnpm test -- src/lib/domain/recurrence.test.ts src/lib/services/charge-generator.integration.test.ts
git add src/lib/domain/recurrence* src/lib/services/charge-generator* src/app/api/cron
git commit -m "feat: generate recurring charges idempotently"
```

## Task 8: Implement authentication and protected layouts

**Files:**
- Create: `src/lib/auth/require-user.ts`
- Create: `src/lib/auth/actions.ts`
- Create: `src/lib/auth/actions.test.ts`
- Create: `src/app/(auth)/login/page.tsx`
- Create: `src/components/auth/login-form.tsx`
- Create: `src/app/(app)/layout.tsx`
- Create: `src/components/layout/app-shell.tsx`
- Create: `src/components/layout/sidebar.tsx`
- Create: `src/components/layout/topbar.tsx`
- Create: `src/components/theme-provider.tsx`
- Create: `src/components/theme-toggle.tsx`
- Create: `src/app/(app)/loading.tsx`

**Step 1: Write failing auth action tests**

Mock the Supabase server client and assert invalid email/password inputs are rejected before network access, failed logins return a safe message, and logout redirects to `/login`.

**Step 2: Verify failure**

Run: `pnpm test -- src/lib/auth/actions.test.ts`

Expected: FAIL.

**Step 3: Implement auth actions and route protection**

- Email/password login only.
- Persistent cookie session through `@supabase/ssr`.
- `requireUser()` uses verified user retrieval, not untrusted local session data.
- Every route except `/login` is private.
- Successful login redirects to `/dashboard`; logout redirects to `/login`.

**Step 4: Build the shell**

Intent checkpoint:

```text
Intent: owner-operator checking cash and obligations at the start of the day; fast and calm.
Palette: ink blue, paper white, action violet, collection green, warning amber, debt red.
Depth: subtle borders and quiet shadows.
Surfaces: canvas, card, overlay, inset control.
Typography: expressive sans for hierarchy and tabular numerals for money.
Spacing: 4px base unit.
```

Build fixed desktop navigation, mobile drawer, topbar, quick-create menu, theme modes, keyboard focus, and loading skeleton.

**Step 5: Add a browser smoke test**

Verify unauthenticated `/dashboard` redirects to `/login` and the login form has labeled email/password fields.

**Step 6: Verify and commit**

```powershell
pnpm test -- src/lib/auth/actions.test.ts
pnpm typecheck
git add src/lib/auth src/app src/components
git commit -m "feat: add authentication and application shell"
```

## Task 9: Implement client management

**Files:**
- Create: `src/lib/validations/client.ts`
- Create: `src/lib/validations/client.test.ts`
- Create: `src/lib/queries/clients.ts`
- Create: `src/lib/actions/clients.ts`
- Create: `src/components/clients/client-form.tsx`
- Create: `src/components/clients/client-list.tsx`
- Create: `src/components/clients/client-header.tsx`
- Create: `src/components/clients/client-tabs.tsx`
- Create: `src/app/(app)/clients/page.tsx`
- Create: `src/app/(app)/clients/new/page.tsx`
- Create: `src/app/(app)/clients/[id]/page.tsx`
- Create: `src/app/(app)/clients/[id]/edit/page.tsx`
- Create: `src/app/(app)/clients/loading.tsx`
- Create: `src/app/(app)/clients/error.tsx`
- Create: `tests/e2e/clients.spec.ts`

**Step 1: Write failing validation tests**

Verify name is required, email is optional but valid when provided, URL is optional, and status is constrained.

**Step 2: Implement validation and server actions**

All actions call `requireUser()`, validate with Zod, and return structured field/form errors. Archive clients by status; never delete them.

**Step 3: Implement reusable queries**

Create `getClients(filters)`, `getClientById(id)`, and `getClientSummary(id)` without N+1 queries.

**Step 4: Build pages and forms**

- List with search and filters for active, paused, archived, debt, and current.
- Responsive table/cards and a purposeful empty state.
- Minimal create form with optional details grouped separately.
- Detail header, quick actions, and tabs.
- Edit and archive confirmation.

**Step 5: Write and run the browser flow**

Test creating, editing, searching, opening, and archiving a client.

Run:

```powershell
pnpm test -- src/lib/validations/client.test.ts
pnpm test:e2e -- tests/e2e/clients.spec.ts
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/lib/validations/client* src/lib/queries/clients.ts src/lib/actions/clients.ts src/components/clients src/app/(app)/clients tests/e2e/clients.spec.ts
git commit -m "feat: add client management"
```

## Task 10: Implement services and automatic charge creation

**Files:**
- Create: `src/lib/validations/service.ts`
- Create: `src/lib/validations/service.test.ts`
- Create: `src/lib/queries/services.ts`
- Create: `src/lib/actions/services.ts`
- Create: `src/components/services/service-form.tsx`
- Create: `src/components/services/service-list.tsx`
- Create: `src/app/(app)/clients/[id]/services/page.tsx` or integrate into the client tab route chosen by App Router conventions
- Create: `tests/e2e/services.spec.ts`

**Step 1: Write failing service validation tests**

Verify positive amount, supported currency/frequency, billing day from 1 through 31, required start date, and end date not before start date.

**Step 2: Implement service actions transactionally**

Creating an active recurring service must insert the service and call recurring generation in one controlled workflow. Editing price affects only unpaid future charges; paid charges never change. Deactivation stops future generation.

**Step 3: Build client-scoped service UI**

The client is preselected. Show status, amount, cadence, next due date, and automatic-generation state. Confirm cancellation/deactivation.

**Step 4: Test the full flow**

Create, edit, deactivate, and verify three future charges are generated without duplicates.

**Step 5: Verify and commit**

```powershell
pnpm test -- src/lib/validations/service.test.ts src/lib/domain/recurrence.test.ts
pnpm test:e2e -- tests/e2e/services.spec.ts
git add src/lib/validations/service* src/lib/queries/services.ts src/lib/actions/services.ts src/components/services src/app/(app)/clients tests/e2e/services.spec.ts
git commit -m "feat: add recurring client services"
```

## Task 11: Implement charges and payment transactions

**Files:**
- Create: `src/lib/validations/charge.ts`
- Create: `src/lib/validations/payment.ts`
- Create: `src/lib/validations/payment.test.ts`
- Create: `src/lib/queries/charges.ts`
- Create: `src/lib/actions/charges.ts`
- Create: `src/lib/actions/payments.ts`
- Create: `src/lib/actions/payments.integration.test.ts`
- Create: `src/components/charges/charges-table.tsx`
- Create: `src/components/charges/charge-filters.tsx`
- Create: `src/components/charges/charge-status-badge.tsx`
- Create: `src/components/payments/payment-dialog.tsx`
- Create: `src/components/payments/payment-history.tsx`
- Create: `src/app/(app)/charges/page.tsx`
- Create: `src/app/(app)/charges/loading.tsx`
- Create: `tests/e2e/payments.spec.ts`

**Step 1: Write failing validation and transaction tests**

Reject zero/negative payments, mismatched currency, overpayments unless explicitly confirmed, missing client, and invalid commercial dates. Verify two partial payments preserve both rows and update `amountPaidMinor` correctly.

**Step 2: Implement transactional payment registration**

Within one database transaction:

1. lock/read the charge;
2. validate currency and remaining balance;
3. insert a payment;
4. recompute the paid amount from payment history;
5. update the charge persisted state;
6. return the new balance.

Deleting/correcting a payment must also recompute the charge from history.

**Step 3: Implement charge queries and filters**

Support all, current month, upcoming, due today, overdue, partial, paid, client, currency, service, and date range. Derived status filtering must use centralized date/status logic or an equivalent correct SQL expression.

**Step 4: Build the operational UI**

- Clear status badges.
- Amount, paid amount, balance, due date, and actions.
- Responsive cards on narrow screens.
- Payment dialog prefilled with client, charge, remaining balance, today, and default method.
- Payment history visible from the charge/client context.

**Step 5: Run the critical browser test**

Create an overdue charge, register a partial payment, verify partial state and remaining balance, register the remainder, and verify paid state plus two preserved payments.

**Step 6: Verify and commit**

```powershell
pnpm test -- src/lib/validations/payment.test.ts src/lib/actions/payments.integration.test.ts
pnpm test:e2e -- tests/e2e/payments.spec.ts
git add src/lib/validations src/lib/queries/charges.ts src/lib/actions/charges.ts src/lib/actions/payments* src/components/charges src/components/payments src/app/(app)/charges tests/e2e/payments.spec.ts
git commit -m "feat: add charges and payment history"
```

## Task 12: Build the real-data dashboard

**Files:**
- Create: `src/lib/queries/dashboard.ts`
- Create: `src/lib/queries/dashboard.integration.test.ts`
- Create: `src/components/dashboard/kpi-strip.tsx`
- Create: `src/components/dashboard/upcoming-charges.tsx`
- Create: `src/components/dashboard/pending-tasks.tsx`
- Create: `src/components/dashboard/upcoming-movements.tsx`
- Create: `src/components/dashboard/revenue-trend.tsx`
- Create: `src/app/(app)/dashboard/page.tsx`
- Create: `src/app/(app)/dashboard/loading.tsx`
- Create: `tests/e2e/dashboard.spec.ts`

**Step 1: Write failing dashboard query tests**

Seed controlled rows and assert collected, pending, overdue, MRR, active client count, seven-day charge count, and six-month trend values. Assert USD and ARS remain separate.

**Step 2: Implement reusable aggregate queries**

Implement `getDashboardMetrics`, `getUpcomingCharges`, `getPendingTasks`, `getUpcomingMovements`, and `getMonthlyRevenue`. Avoid one query per card and avoid N+1 relations.

**Step 3: Build dashboard components**

Follow the approved reference composition while preserving the product signature:

- financial KPI strip grouped by currency;
- compact client and upcoming-charge counts;
- overdue-first charge table;
- pending task list;
- unified chronological movement rail;
- useful six-month trend only after core information is complete.

**Step 4: Verify responsive and empty states**

Test desktop, tablet, and mobile sizes. With an empty database, show actions instead of empty tables.

**Step 5: Verify and commit**

```powershell
pnpm test -- src/lib/queries/dashboard.integration.test.ts
pnpm test:e2e -- tests/e2e/dashboard.spec.ts
git add src/lib/queries/dashboard* src/components/dashboard src/app/(app)/dashboard tests/e2e/dashboard.spec.ts
git commit -m "feat: add real-time business dashboard"
```

## Task 13: Implement tasks and basic recurrence

**Files:**
- Create: `src/lib/validations/task.ts`
- Create: `src/lib/domain/task-recurrence.ts`
- Create: `src/lib/domain/task-recurrence.test.ts`
- Create: `src/lib/queries/tasks.ts`
- Create: `src/lib/actions/tasks.ts`
- Create: `src/components/tasks/task-form.tsx`
- Create: `src/components/tasks/task-list.tsx`
- Create: `src/components/tasks/task-filters.tsx`
- Create: `src/app/(app)/tasks/page.tsx`
- Create: client-task tab files under `src/app/(app)/clients/[id]/`
- Create: `tests/e2e/tasks.spec.ts`

**Step 1: Write failing recurrence and validation tests**

Verify optional dates, valid priority/status, and that completing a monthly recurring task produces exactly one next instance with the expected date.

**Step 2: Implement transactional task actions**

Create, edit, complete, reopen, and delete with confirmation. Completion sets `completedAt`; recurring completion creates the next instance idempotently.

**Step 3: Build global and client-scoped task views**

Support all, today, upcoming, overdue, completed, and undated filters. Allow direct checkbox completion. Client-created tasks preselect the client.

**Step 4: Verify and commit**

```powershell
pnpm test -- src/lib/domain/task-recurrence.test.ts
pnpm test:e2e -- tests/e2e/tasks.spec.ts
git add src/lib/validations/task.ts src/lib/domain/task-recurrence* src/lib/queries/tasks.ts src/lib/actions/tasks.ts src/components/tasks src/app/(app)/tasks src/app/(app)/clients tests/e2e/tasks.spec.ts
git commit -m "feat: add client task management"
```

## Task 14: Implement notes, client history, and settings

**Files:**
- Create: `src/lib/validations/note.ts`
- Create: `src/lib/validations/settings.ts`
- Create: `src/lib/queries/client-notes.ts`
- Create: `src/lib/queries/settings.ts`
- Create: `src/lib/actions/client-notes.ts`
- Create: `src/lib/actions/settings.ts`
- Create: `src/components/clients/notes-timeline.tsx`
- Create: `src/components/settings/profile-form.tsx`
- Create: `src/components/settings/business-form.tsx`
- Create: `src/app/(app)/settings/page.tsx`
- Create: `tests/e2e/client-history.spec.ts`

**Step 1: Write failing validation tests**

Reject blank notes and unsupported timezones/currencies. Accept the initial business timezone and supported currency enum.

**Step 2: Implement note and settings actions**

Require authentication, validate all inputs, order notes newest first, and confirm note deletion. Settings default to `America/Argentina/Buenos_Aires`, `es-AR`, and a chosen principal currency without affecting grouped financial totals.

**Step 3: Complete client history tabs**

The client summary must show active services, total collected by currency, debt by currency, MRR, next due date, tasks, notes, charges, and payment history.

**Step 4: Verify and commit**

```powershell
pnpm test
pnpm test:e2e -- tests/e2e/client-history.spec.ts
git add src/lib/validations src/lib/queries src/lib/actions src/components/clients src/components/settings src/app/(app)/settings src/app/(app)/clients tests/e2e/client-history.spec.ts
git commit -m "feat: add client notes history and settings"
```

## Task 15: Add demo seed and deterministic test data

**Files:**
- Create: `src/db/seed.ts`
- Create: `src/db/seed-data.ts`
- Create: `src/db/seed-data.test.ts`
- Modify: `package.json`

**Step 1: Write a failing seed contract test**

Assert the seed contains active clients, USD and ARS services, paid/pending/overdue/partial charges, multiple payments, tasks, and notes without relying on the current wall-clock date.

**Step 2: Implement idempotent seed data**

Use stable UUIDs and upserts. Include Estudio Norte, Empresa Demo, Cliente Global, Tech Solutions, and StartUp Labs. Derive commercial dates from one explicit seed reference date or reset them on each seed run.

**Step 3: Run the seed twice**

Run:

```powershell
pnpm db:seed
pnpm db:seed
```

Expected: both runs succeed and row counts do not double.

**Step 4: Verify dashboard visually**

Open the local dashboard and confirm representative data appears in every required state and both currencies.

**Step 5: Commit**

```powershell
git add src/db package.json pnpm-lock.yaml
git commit -m "chore: add idempotent demo data"
```

## Task 16: Accessibility, responsive behavior, and visual polish

**Files:**
- Modify: `src/app/globals.css`
- Modify: components under `src/components/`
- Create: `tests/e2e/accessibility-and-responsive.spec.ts`

**Step 1: Write browser assertions before fixes**

Cover keyboard navigation, visible focus, dialog focus trapping, labels, mobile navigation, table/card adaptation, contrast-sensitive status badges, and theme persistence.

**Step 2: Run tests and capture current failures**

Run: `pnpm test:e2e -- tests/e2e/accessibility-and-responsive.spec.ts`

Expected: at least one assertion fails before final polish.

**Step 3: Apply the design-system checks**

- Use the 4px spacing grid.
- Use only declared palette and semantic tokens.
- Keep one subtle depth strategy.
- Use four text hierarchy levels.
- Ensure every interactive control has hover, active, focus, disabled, loading, and error states.
- Confirm the movement rail is visibly the product signature in at least five contexts/states.
- Run swap, squint, signature, and token checks from `@interface-design`.

**Step 4: Verify three viewport classes**

Capture and inspect dashboard, clients, charges, client detail, tasks, settings, and login at desktop, tablet, and mobile widths. Fix overflow, clipping, touch targets, and hierarchy defects.

**Step 5: Run the browser suite and commit**

```powershell
pnpm test:e2e -- tests/e2e/accessibility-and-responsive.spec.ts
git add src tests/e2e/accessibility-and-responsive.spec.ts
git commit -m "fix: polish responsive and accessible interactions"
```

## Task 17: Complete README and operator instructions

**Files:**
- Create: `README.md`
- Modify: `.env.example`

**Step 1: Draft the README**

Document:

- product purpose and scope;
- architecture and directory map;
- prerequisites;
- pnpm install and local development;
- Supabase project creation and required credentials;
- migration and seed commands;
- authentication user creation;
- test, lint, typecheck, and build commands;
- cron endpoint structure without enabling deployment;
- backup/safety notes;
- future GitHub/Vercel steps clearly marked as out of the current phase.

**Step 2: Validate every documented command**

Run each setup/verification command exactly as written against a clean checkout or temporary validation worktree. Correct stale paths or assumptions.

**Step 3: Scan for leaked secrets**

Run:

```powershell
git grep -n -I -E "(service_role|postgresql://[^ ]+:[^ ]+@|SUPABASE_SECRET_KEY=.+)"
```

Expected: no real credential values. Placeholders in documentation are acceptable only when unmistakably empty or fake.

**Step 4: Commit**

```powershell
git add README.md .env.example
git commit -m "docs: add local setup and operating guide"
```

## Task 18: Run the complete acceptance gate

**Files:**
- Modify only files required to fix verified failures.
- Create: `docs/verification/local-mvp-verification.md`

**Step 1: Run static checks**

```powershell
pnpm typecheck
pnpm lint
```

Expected: both exit with code 0 and no critical warnings.

**Step 2: Run all automated tests**

```powershell
pnpm test
pnpm test:e2e
```

Expected: all unit, integration, and browser tests pass.

**Step 3: Run the production build**

```powershell
pnpm build
```

Expected: Next.js production build completes successfully with no TypeScript errors.

**Step 4: Manually execute the MVP acceptance flow**

Using the real remote Supabase database:

1. log in;
2. create and edit a client;
3. create a monthly service;
4. verify automatic charges in Dashboard and Cobros;
5. register a partial payment;
6. register the remainder and verify Paid;
7. verify dashboard metrics update by currency;
8. create, edit, filter, and complete a client task;
9. create, edit, and delete a note;
10. inspect client services, charges, payments, tasks, and notes;
11. archive the client safely;
12. repeat key reads on mobile viewport and in dark mode.

**Step 5: Record evidence**

Write exact command results, test counts, build status, tested browser/viewports, Supabase migration version, and any genuine external pending items to `docs/verification/local-mvp-verification.md`.

**Step 6: Review the branch**

Use `@requesting-code-review` and address all high-confidence critical or important findings. Re-run affected checks after changes.

**Step 7: Final verification and commit**

Run the entire static/test/build gate once more after review.

```powershell
git add docs/verification src tests
git commit -m "chore: verify local MVP acceptance"
git status --short
```

Expected: final commit succeeds and the worktree is clean.

## Official references

- Next.js 16 installation: <https://nextjs.org/docs/app/getting-started/installation>
- Next.js App Router: <https://nextjs.org/docs/app/getting-started>
- Supabase Auth with Next.js: <https://supabase.com/docs/guides/auth/quickstarts/nextjs>
- Supabase SSR package selection: <https://supabase.com/docs/guides/auth/choosing-a-server-package>
- Drizzle with Supabase: <https://orm.drizzle.team/docs/tutorials/drizzle-with-supabase>
- Drizzle Row-Level Security: <https://orm.drizzle.team/docs/rls>
