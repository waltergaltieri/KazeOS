# Charges and Payments Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add owner-scoped charge management and append-preserving payment history with a fast, responsive Spanish ledger UI.

**Architecture:** Validated server queries and actions run inside the existing authenticated RLS transaction wrapper. Charge/payment domain services own row locking and mutation safety, while PostgreSQL triggers remain authoritative for synchronized totals and persisted charge status.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, Drizzle ORM, PostgreSQL/Supabase RLS, Vitest, Testing Library, Playwright.

---

### Task 1: Validation contracts

**Files:**
- Create: `src/lib/validations/charge.test.ts`
- Create: `src/lib/validations/charge.ts`
- Create: `src/lib/validations/payment.test.ts`
- Create: `src/lib/validations/payment.ts`

1. Write tests for strict UUIDs, dates, search/filter enums, safe positive money, nullable text normalization, methods, and overpay confirmation.
2. Run the focused tests and confirm failure because the modules do not exist.
3. Implement minimal Zod schemas and typed values.
4. Run focused tests to green.

### Task 2: Charge queries

**Files:**
- Create: `src/lib/queries/charges.test.ts`
- Create: `src/lib/queries/charges.integration.test.ts`
- Create: `src/lib/queries/charges.ts`

1. Write failing tests for filter validation, exact derived-status precedence, deterministic ordering, client/service projection, payment history, and per-currency summaries.
2. Verify RED.
3. Implement owner/RLS-bound, set-based queries without N+1 reads.
4. Verify GREEN locally and against rollback fixtures.

### Task 3: Charge and payment domain mutations

**Files:**
- Create: `src/lib/services/charge-manager.integration.test.ts`
- Create: `src/lib/services/charge-manager.ts`
- Create: `src/lib/services/payment-manager.integration.test.ts`
- Create: `src/lib/services/payment-manager.ts`

1. Write failing integration tests for manual create/edit/cancel safety, two preserved partial rows reaching paid, overpay reject/confirm, mismatches, correction recomputation, and concurrent serialization.
2. Verify RED against the remote test database.
3. Implement scoped `FOR UPDATE` services and trigger-compatible inserts/updates.
4. Verify GREEN and exact cleanup.

### Task 4: Server actions

**Files:**
- Create: `src/lib/actions/charges.test.ts`
- Create: `src/lib/actions/charges.ts`
- Create: `src/lib/actions/payments.test.ts`
- Create: `src/lib/actions/payments.ts`

1. Write failing tests for auth, structured validation errors, safe domain-error mapping, and revalidation.
2. Verify RED.
3. Implement minimal server actions through `withAuthenticatedDb`.
4. Verify GREEN.

### Task 5: Ledger UI and routes

**Files:**
- Create: `src/components/charges/charge-status-badge.tsx`
- Create: `src/components/charges/charge-table.tsx`
- Create: `src/components/charges/charge-form.tsx`
- Create: `src/components/payments/payment-dialog.tsx`
- Create: `src/components/payments/payment-history.tsx`
- Create: `src/app/(app)/charges/page.tsx`
- Create: `src/app/(app)/charges/loading.tsx`
- Create: `src/app/(app)/charges/error.tsx`
- Create: `src/app/(app)/charges/new/page.tsx`
- Create: `src/app/(app)/clients/[id]/charges/page.tsx`
- Modify: `src/components/clients/client-tabs.tsx`
- Modify: `src/app/globals.css`

1. State the interface checkpoint before each component.
2. Write failing component/page tests for accessible filters, table-to-card content, dialog focus/errors/overpay confirmation, payment rail, and empty/loading/error states.
3. Verify RED.
4. Implement the minimal responsive Spanish UI using existing tokens and 4px spacing.
5. Verify GREEN and inspect desktop/mobile in a browser.

### Task 6: Authenticated lifecycle E2E and final gates

**Files:**
- Create: `tests/e2e/payments.spec.ts`
- Create: `tests/contracts/payments-e2e-cleanup.test.ts`

1. Add credential-gated authenticated lifecycle coverage with UUID markers and exact cleanup; do not create an auth user.
2. Run focused, full unit/integration, typecheck, lint, build, available E2E, visual checks, and a secret scan.
3. Report missing E2E credentials as an external acceptance blocker rather than a false pass.
4. Commit all implementation with `feat: add charges and payment history`.
