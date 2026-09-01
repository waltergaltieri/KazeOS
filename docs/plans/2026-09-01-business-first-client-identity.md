# Business-first Client Identity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show the client business as the primary identity and the human contact as secondary everywhere clients are identified.

**Architecture:** Derive a primary and secondary identity from the existing `company`, `firstName`, and `lastName` values. Reuse that display rule in the client list and dossier header without changing persistence or query contracts.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Testing Library, Vercel.

---

### Task 1: Lock the list hierarchy with a failing test

**Files:**
- Modify: `src/components/clients/client-list.test.tsx`

1. Assert that `Estudio Norte` is the primary client link.
2. Assert that `Agustín Pérez` is rendered as the secondary contact.
3. Run the focused test and confirm it fails against the current contact-first rendering.

### Task 2: Invert identity in desktop and responsive lists

**Files:**
- Modify: `src/components/clients/client-list.tsx`
- Modify: `src/app/globals.css`

1. Add small display helpers for contact name, primary identity, and secondary identity.
2. Render the company first on both table and cards.
3. Update accessible open-link names to use the primary identity.
4. Render the contact as secondary with the existing visual hierarchy.
5. Run the focused test and confirm it passes.

### Task 3: Apply the same hierarchy to the dossier header

**Files:**
- Create: `src/components/clients/client-header.test.tsx`
- Modify: `src/components/clients/client-header.tsx`

1. Add a failing component test for company title and contact subtitle.
2. Render company as the heading with contact beneath it.
3. Preserve the individual-client fallback.
4. Run both focused component tests.

### Task 4: Verify and deploy

**Files:**
- No additional production files expected.

1. Run client component tests, typecheck, lint, and production build.
2. Inspect the page at desktop and mobile widths.
3. Commit the change.
4. Deploy explicitly to Vercel Preview and repoint `kazeos-preview.vercel.app`.
