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
import { charges, clients, payments } from "@/db/schema";
import { createPayment, correctPayment, PaymentMismatchError, PaymentOverpayConfirmationRequiredError } from "./payment-manager";

config({ path: ".env.local", quiet: true });
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? postgres(databaseUrl, { prepare: false, max: 1 }) : undefined;
const db = client ? drizzle({ client, schema }) : undefined;
const rollback = new Error("ROLLBACK_PAYMENT_TEST");
afterAll(async () => client?.end());

describeDatabase("payment manager", () => {
  it("preserves rows, recomputes partial/paid, confirms overpay, validates mismatch, and corrects", async () => {
    try { await db!.transaction(async (tx) => {
      const ownerId = randomUUID(), clientId = randomUUID(), chargeId = randomUUID();
      await tx.execute(sql`insert into auth.users (id) values (${ownerId})`);
      await tx.insert(clients).values({ id: clientId, ownerId, firstName: "Pago integrado" });
      await tx.insert(charges).values({ id: chargeId, ownerId, clientId, description: "Cuota", amountMinor: 10_000, currency: "USD", dueDate: "2026-08-31" });
      const asOwner = createAuthenticatedDrizzleRunner(tx);
      const values = (amountMinor: number, confirmOverpay = false) => ({ chargeId, clientId, amountMinor, currency: "USD" as const, paymentDate: "2026-08-31", paymentMethod: "bank_transfer" as const, reference: null, notes: null, confirmOverpay });
      const first = await asOwner(ownerId, (ownerDb) => createPayment(ownerDb, { ownerId, values: values(4_000) }));
      expect((await tx.select().from(charges).where(eq(charges.id, chargeId)))[0]).toMatchObject({ amountPaidMinor: 4_000, status: "partial" });
      await asOwner(ownerId, (ownerDb) => createPayment(ownerDb, { ownerId, values: values(6_000) }));
      expect((await tx.select().from(charges).where(eq(charges.id, chargeId)))[0]).toMatchObject({ amountPaidMinor: 10_000, status: "paid" });
      expect(await tx.select().from(payments).where(eq(payments.chargeId, chargeId))).toHaveLength(2);
      await expect(asOwner(ownerId, (ownerDb) => createPayment(ownerDb, { ownerId, values: values(100) }))).rejects.toBeInstanceOf(PaymentOverpayConfirmationRequiredError);
      await asOwner(ownerId, (ownerDb) => createPayment(ownerDb, { ownerId, values: values(100, true) }));
      await expect(asOwner(ownerId, (ownerDb) => createPayment(ownerDb, { ownerId, values: { ...values(100), clientId: randomUUID() } }))).rejects.toBeInstanceOf(PaymentMismatchError);
      await asOwner(ownerId, (ownerDb) => correctPayment(ownerDb, { ownerId, paymentId: first.id, values: values(3_000, true) }));
      expect((await tx.select().from(charges).where(eq(charges.id, chargeId)))[0]).toMatchObject({ amountPaidMinor: 9_100, status: "partial" });
      throw rollback;
    }); } catch (error) { if (error !== rollback) throw error; }
  }, 30_000);

  it("serializes concurrent payments and rejects a stale overpayment", async () => {
    const ownerId = randomUUID(), clientId = randomUUID(), chargeId = randomUUID();
    const firstClient = postgres(databaseUrl!, { prepare: false, max: 1 });
    const secondClient = postgres(databaseUrl!, { prepare: false, max: 1 });
    const firstDb = drizzle({ client: firstClient, schema });
    const secondDb = drizzle({ client: secondClient, schema });
    try {
      await db!.transaction(async (tx) => {
        await tx.execute(sql`insert into auth.users (id) values (${ownerId})`);
        await tx.insert(clients).values({ id: clientId, ownerId, firstName: "Pago concurrente" });
        await tx.insert(charges).values({ id: chargeId, ownerId, clientId, description: "Cuota concurrente", amountMinor: 10_000, currency: "USD", dueDate: "2026-08-31" });
      });
      const values = (amountMinor: number) => ({ chargeId, clientId, amountMinor, currency: "USD" as const, paymentDate: "2026-08-31", paymentMethod: "bank_transfer" as const, reference: null, notes: null, confirmOverpay: false });
      let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
      let inserted!: () => void; const firstInserted = new Promise<void>((resolve) => { inserted = resolve; });
      const runFirst = createAuthenticatedDrizzleRunner(firstDb);
      const runSecond = createAuthenticatedDrizzleRunner(secondDb);
      const first = runFirst(ownerId, async (ownerDb) => { const result = await createPayment(ownerDb, { ownerId, values: values(7_000) }); inserted(); await held; return result; });
      await firstInserted;
      const second = runSecond(ownerId, (ownerDb) => createPayment(ownerDb, { ownerId, values: values(5_000) }));
      const state = await Promise.race([second.then(() => "settled", () => "settled"), new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), 250))]);
      expect(state).toBe("blocked");
      release();
      await expect(first).resolves.toMatchObject({ chargeId });
      await expect(second).rejects.toBeInstanceOf(PaymentOverpayConfirmationRequiredError);
      expect(await db!.select().from(payments).where(eq(payments.chargeId, chargeId))).toHaveLength(1);
      expect((await db!.select().from(charges).where(eq(charges.id, chargeId)))[0]).toMatchObject({ amountPaidMinor: 7_000, status: "partial" });
    } finally {
      await firstClient.end(); await secondClient.end();
      await db!.delete(payments).where(eq(payments.chargeId, chargeId));
      await db!.delete(charges).where(eq(charges.id, chargeId));
      await db!.delete(clients).where(eq(clients.id, clientId));
      await db!.execute(sql`delete from auth.users where id = ${ownerId}`);
      expect((await db!.select().from(payments).where(eq(payments.chargeId, chargeId))).length).toBe(0);
      expect((await db!.select().from(charges).where(eq(charges.id, chargeId))).length).toBe(0);
      expect((await db!.select().from(clients).where(eq(clients.id, clientId))).length).toBe(0);
    }
  }, 30_000);
});
