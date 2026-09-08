# Shared Currency Preference Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reuse the top-bar USD/ARS selector on Dashboard and Gastos and remember the last selected currency across both screens.

**Architecture:** Keep the current URL parameter as the authoritative currency for each rendered page and add a small shared resolver that falls back to a first-party cookie, then USD. The protected layout supplies the remembered value to the client top bar, whose links preserve expense filters and update the cookie before navigation.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Testing Library.

---

### Task 1: Define the shared currency preference contract

**Files:**
- Create: `src/lib/preferences/currency.ts`
- Create: `src/lib/preferences/currency.test.ts`

**Step 1: Write the failing tests**

Add cases for `resolveCurrencyPreference(requested, remembered)` proving that a
valid URL value wins, a valid remembered value is used when the URL is absent or
invalid, and USD is the final fallback. Assert that only `USD` and `ARS` are
accepted.

**Step 2: Run the tests and verify failure**

Run: `corepack pnpm test -- src/lib/preferences/currency.test.ts`

Expected: FAIL because the currency preference module does not exist.

**Step 3: Implement the minimal shared helper**

Export the cookie name, cookie lifetime, a strict currency parser, and the
resolver. Keep the module free of client-only or server-only imports so pages,
layout, and top bar can share it.

**Step 4: Run the focused tests**

Run: `corepack pnpm test -- src/lib/preferences/currency.test.ts`

Expected: PASS.

### Task 2: Make the top-bar selector shared and persistent

**Files:**
- Modify: `src/components/layout/topbar.tsx`
- Modify: `src/components/layout/app-shell.tsx`
- Modify: `src/components/layout/app-shell.test.tsx`

**Step 1: Write the failing component tests**

Change the existing selector test to require it on both `/dashboard` and
`/expenses`, require it to remain absent on `/expenses/recurring` and other
routes, and verify an initial remembered ARS value is selected when the URL has
no currency. Add a filtered expenses URL case asserting that switching currency
preserves filters, removes `page`, and records the ARS cookie.

**Step 2: Run the tests and verify failure**

Run: `corepack pnpm test -- src/components/layout/app-shell.test.tsx`

Expected: FAIL because the selector is dashboard-only and does not persist its
selection.

**Step 3: Implement the shared top-bar behavior**

Add an optional `initialCurrency` prop through `AppShell` into `Topbar`. Resolve
the active currency from the URL and that prop. Render the existing selector on
the two exact index routes, build links from the current search parameters,
delete `page`, and write the preference cookie from the currency link click.

**Step 4: Run the component tests**

Run: `corepack pnpm test -- src/components/layout/app-shell.test.tsx`

Expected: PASS.

### Task 3: Apply the remembered preference to server rendering

**Files:**
- Modify: `src/app/(app)/layout.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `src/app/(app)/dashboard/page.test.tsx`
- Modify: `src/app/(app)/expenses/page.tsx`
- Modify: `src/app/(app)/expenses/page.test.tsx`

**Step 1: Write the failing page tests**

Mock `next/headers` cookies and add cases proving both pages use remembered ARS
when the URL omits currency, explicit USD overrides remembered ARS, and an
invalid remembered value falls back to USD. Update expenses assertions so the
page has no local currency navigation.

**Step 2: Run the tests and verify failure**

Run: `corepack pnpm test -- src/app/\(app\)/dashboard/page.test.tsx src/app/\(app\)/expenses/page.test.tsx`

Expected: FAIL because both pages currently default directly to USD and Gastos
still renders its local selector.

**Step 3: Implement server-side preference resolution**

Read the preference cookie in the protected layout, dashboard page, and expenses
page. Use the shared resolver everywhere, pass the remembered currency to
`AppShell`, and remove `currencyHref` plus the local expenses selector.

**Step 4: Run the page tests**

Run: `corepack pnpm test -- src/app/\(app\)/dashboard/page.test.tsx src/app/\(app\)/expenses/page.test.tsx`

Expected: PASS.

### Task 4: Remove obsolete styling and verify the feature

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/components/expenses/expense-accessibility.test.ts`

**Step 1: Update the style contract test**

Remove the assertion for `.expense-currency-switch` and retain coverage for the
remaining expenses touch targets.

**Step 2: Remove obsolete CSS**

Delete desktop and responsive `.expense-currency-switch` rules. Keep
`.expense-heading-actions` for the primary `Nuevo gasto` action.

**Step 3: Run all focused tests**

Run: `corepack pnpm test -- src/lib/preferences/currency.test.ts src/components/layout/app-shell.test.tsx src/app/\(app\)/dashboard/page.test.tsx src/app/\(app\)/expenses/page.test.tsx src/components/expenses/expense-accessibility.test.ts`

Expected: PASS.

**Step 4: Run project verification**

Run: `corepack pnpm typecheck`

Expected: PASS.

Run: `corepack pnpm lint`

Expected: PASS.

Run: `corepack pnpm build`

Expected: PASS.
