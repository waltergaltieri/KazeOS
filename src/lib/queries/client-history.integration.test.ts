// @vitest-environment node

import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const runtime = vi.hoisted(() => ({ userId: "", email: "", run: undefined as undefined | ((ownerId: string, operation: (db: never) => unknown) => unknown) }));
vi.mock("@/lib/auth/require-user", () => ({ requireUser: async () => ({ id: runtime.userId, email: runtime.email }) }));
vi.mock("@/db", () => ({ withAuthenticatedDb: (ownerId: string, operation: (db: never) => unknown) => runtime.run!(ownerId, operation) }));

import { createAuthenticatedDrizzleRunner } from "@/db/authenticated";
import * as schema from "@/db/schema";
import { clientNotes, clients, profiles, settings } from "@/db/schema";
import { getClientNotes } from "./client-notes";
import { getSettings } from "./settings";

config({ path: ".env.local", quiet: true });
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const sqlClient = databaseUrl ? postgres(databaseUrl, { prepare: false, max: 1 }) : undefined;
const database = sqlClient ? drizzle({ client: sqlClient, schema }) : undefined;
type Database = NonNullable<typeof database>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
const rollback = new Error("ROLLBACK_CLIENT_HISTORY");
afterAll(async () => sqlClient?.end());

describeDatabase("client history and settings through RLS", () => {
  it("isolates newest-first notes and returns saved regional preferences", async () => {
    try {
      await database!.transaction(async (transaction: Transaction) => {
        const ownerId = randomUUID(); const otherOwnerId = randomUUID(); const clientId = randomUUID(); const otherClientId = randomUUID(); const ownNoteId = randomUUID(); const otherNoteId = randomUUID();
        await transaction.execute(sql`insert into auth.users (id, email) values (${ownerId}, 'history-owner@example.invalid'), (${otherOwnerId}, 'history-other@example.invalid')`);
        await transaction.insert(clients).values([{ id: clientId, ownerId, firstName: "Historial" }, { id: otherClientId, ownerId: otherOwnerId, firstName: "Ajeno" }]);
        await transaction.insert(clientNotes).values([
          { id: ownNoteId, ownerId, clientId, content: "Anterior", createdAt: new Date("2026-08-30T10:00:00Z") },
          { ownerId, clientId, content: "Reciente", createdAt: new Date("2026-08-31T10:00:00Z") },
          { id: otherNoteId, ownerId: otherOwnerId, clientId: otherClientId, content: "No visible" },
        ]);
        await transaction.insert(profiles).values({ id: ownerId, fullName: "Agustín RLS", email: "history-owner@example.invalid" });
        await transaction.insert(settings).values({ ownerId, primaryCurrency: "ARS", timezone: "America/Argentina/Buenos_Aires", locale: "es-AR", businessName: "Kaze RLS" });
        runtime.userId = ownerId; runtime.email = "history-owner@example.invalid"; runtime.run = createAuthenticatedDrizzleRunner(transaction) as typeof runtime.run;
        await expect(getClientNotes(clientId)).resolves.toMatchObject([{ content: "Reciente" }, { content: "Anterior" }]);
        await expect(getClientNotes(otherClientId)).resolves.toEqual([]);
        await expect(getSettings()).resolves.toMatchObject({ profile: { fullName: "Agustín RLS" }, business: { primaryCurrency: "ARS", timezone: "America/Argentina/Buenos_Aires", locale: "es-AR", businessName: "Kaze RLS" } });
        const authenticated = createAuthenticatedDrizzleRunner(transaction);
        await authenticated(ownerId, async (ownerDatabase) => {
          const changed = await ownerDatabase.update(clientNotes).set({ content: "Editada" }).where(eq(clientNotes.id, ownNoteId)).returning({ id: clientNotes.id });
          expect(changed).toEqual([{ id: ownNoteId }]);
          const hiddenDelete = await ownerDatabase.delete(clientNotes).where(eq(clientNotes.id, otherNoteId)).returning({ id: clientNotes.id });
          expect(hiddenDelete).toEqual([]);
          const removed = await ownerDatabase.delete(clientNotes).where(eq(clientNotes.id, ownNoteId)).returning({ id: clientNotes.id });
          expect(removed).toEqual([{ id: ownNoteId }]);
          await ownerDatabase.update(settings).set({ businessName: "Kaze actualizado" }).where(eq(settings.ownerId, ownerId));
        });
        throw rollback;
      });
    } catch (error) { if (error !== rollback) throw error; }
  }, 30_000);
});
