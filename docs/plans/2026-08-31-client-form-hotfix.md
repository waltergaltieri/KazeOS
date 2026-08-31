# Client Form Hotfix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make new-client submission reject malformed websites normally and make company versus contact-person fields unmistakable.

**Architecture:** Keep the existing action and database shape. Harden the shared client validation schema with a non-throwing protocol check, then reorganize the existing form fields without renaming submitted keys.

**Tech Stack:** Next.js 16, React 19, Zod 4, Vitest, Testing Library, Vercel.

---

### Task 1: Reproduce website validation crash

**Files:**
- Modify: `src/lib/validations/client.test.ts`

1. Add create and update regression cases using `656.ar`.
2. Run `corepack pnpm test -- src/lib/validations/client.test.ts`.
3. Confirm both cases fail because `safeParse` throws `TypeError: Invalid URL`.

### Task 2: Make website validation non-throwing

**Files:**
- Modify: `src/lib/validations/client.ts`

1. Add a small `hasHttpProtocol(value)` helper that catches malformed URLs.
2. Use it in create and update website refinements.
3. Run the focused validation test and confirm it passes.

### Task 3: Clarify company and contact fields

**Files:**
- Create: `src/components/clients/client-form.test.tsx`
- Modify: `src/components/clients/client-form.tsx`

1. Add a component test requiring `Empresa o nombre comercial`, `Nombre de la persona de contacto`, and the four explicit section headings.
2. Run the focused component test and confirm it fails against the old labels.
3. Reorganize the existing fields and labels without changing form-data names.
4. Run the focused component test and confirm it passes.

### Task 4: Verify and deploy

**Files:**
- No production-file changes expected.

1. Run focused tests, the non-integration suite, typecheck, lint, and production build.
2. Commit the hotfix.
3. Deploy explicitly to Vercel Preview and repoint `kazeos-preview.vercel.app`.
4. Verify the published submission flow and review fresh runtime error logs.
