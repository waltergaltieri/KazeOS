// @vitest-environment node
import { randomUUID } from "node:crypto";
import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createAuthenticatedDrizzleRunner } from "@/db/authenticated";
import * as schema from "@/db/schema";
import { charges, clients } from "@/db/schema";
import { cancelManualCharge, ChargeFinanciallyLockedError, createManualCharge, updateManualCharge } from "./charge-manager";
config({ path: ".env.local", quiet: true }); const url = process.env.DATABASE_URL; const describeDb = url ? describe : describe.skip; const client = url ? postgres(url, { prepare: false, max: 1 }) : undefined; const db = client ? drizzle({ client, schema }) : undefined; const rollback = new Error("ROLLBACK_CHARGE_TEST"); afterAll(async () => client?.end());
describeDb("manual charge manager", () => { it("creates, safely edits and cancels without deleting history", async () => { try { await db!.transaction(async (tx) => { const ownerId = randomUUID(), clientId = randomUUID(); await tx.execute(sql`insert into auth.users (id) values (${ownerId})`); await tx.insert(clients).values({ id: clientId, ownerId, firstName: "Cargo manual" }); const run = createAuthenticatedDrizzleRunner(tx); const values = { clientId, description: "Anticipo", amountMinor: 10_000, currency: "USD" as const, dueDate: "2026-09-01", notes: null }; const created = await run(ownerId, (ownerDb) => createManualCharge(ownerDb, { ownerId, values })); await run(ownerId, (ownerDb) => updateManualCharge(ownerDb, { ownerId, chargeId: created.id, values: { ...values, description: "Saldo", amountMinor: 12_000 } })); expect((await tx.select().from(charges).where(eq(charges.id, created.id)))[0]).toMatchObject({ description: "Saldo", amountMinor: 12_000, status: "pending", generatedAutomatically: false }); await run(ownerId, (ownerDb) => cancelManualCharge(ownerDb, { ownerId, chargeId: created.id })); expect((await tx.select().from(charges).where(eq(charges.id, created.id)))[0]?.status).toBe("cancelled"); expect(await tx.select().from(charges).where(eq(charges.id, created.id))).toHaveLength(1); await expect(run(ownerId, (ownerDb) => updateManualCharge(ownerDb, { ownerId, chargeId: created.id, values }))).rejects.toBeInstanceOf(ChargeFinanciallyLockedError); throw rollback; }); } catch (error) { if (error !== rollback) throw error; } }, 30_000); });
