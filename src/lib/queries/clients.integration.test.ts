// @vitest-environment node

import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const runtime = vi.hoisted(() => ({
  userId: "",
  run: undefined as undefined | ((ownerId: string, operation: (db: never) => unknown) => unknown),
}));

vi.mock("@/lib/auth/require-user", () => ({
  requireUser: async () => ({ id: runtime.userId }),
}));
vi.mock("@/db", () => ({
  withAuthenticatedDb: (ownerId: string, operation: (db: never) => unknown) => runtime.run!(ownerId, operation),
}));

import { createAuthenticatedDrizzleRunner } from "@/db/authenticated";
import * as schema from "@/db/schema";
import { charges, clients } from "@/db/schema";

import { getClientSummary, getClients } from "./clients";

config({ path: ".env.local", quiet: true });
const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const client = databaseUrl ? postgres(databaseUrl, { prepare: false, max: 1 }) : undefined;
const database = client ? drizzle({ client, schema }) : undefined;
const rollback = new Error("ROLLBACK_CLIENT_QUERY_TEST");
type Database = NonNullable<typeof database>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

afterAll(async () => client?.end());

describeDatabase("client queries against RLS", () => {
  it("isolates owners and separates outstanding currencies", async () => {
    try {
      await database!.transaction(async (transaction: Transaction) => {
        const ownerId = randomUUID();
        const otherOwnerId = randomUUID();
        const debtClientId = randomUUID();
        const currentClientId = randomUUID();
        await transaction.execute(sql`insert into auth.users (id) values (${ownerId}), (${otherOwnerId})`);
        await transaction.insert(clients).values([
          { id: debtClientId, ownerId, firstName: "Deuda" },
          { id: currentClientId, ownerId, firstName: "Al día" },
          { ownerId: otherOwnerId, firstName: "Ajeno" },
        ]);
        await transaction.insert(charges).values([
          { ownerId, clientId: debtClientId, description: "USD", amountMinor: 10_000, currency: "USD", dueDate: "2026-08-01", status: "pending" },
          { ownerId, clientId: debtClientId, description: "ARS", amountMinor: 90_000, currency: "ARS", dueDate: "2026-08-01", status: "pending" },
          { ownerId, clientId: debtClientId, description: "Cancelado", amountMinor: 999_999, currency: "USD", dueDate: "2026-08-01", status: "cancelled" },
        ]);

        runtime.userId = ownerId;
        runtime.run = createAuthenticatedDrizzleRunner(transaction) as typeof runtime.run;

        const debt = await getClients({ filter: "debt" });
        expect(debt).toHaveLength(1);
        expect(debt[0]).toMatchObject({ id: debtClientId, outstanding: { USD: "10000", ARS: "90000" } });
        await expect(getClients({ filter: "current" })).resolves.toEqual([
          expect.objectContaining({ id: currentClientId }),
        ]);
        await expect(getClientSummary(debtClientId)).resolves.toMatchObject({
          outstanding: { USD: "10000", ARS: "90000" },
        });

        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }, 30_000);

  it("returns two maximum charge rows as an exact serializable aggregate", async () => {
    try {
      await database!.transaction(async (transaction: Transaction) => {
        const ownerId = randomUUID();
        const clientId = randomUUID();
        const exactTotal = (BigInt(Number.MAX_SAFE_INTEGER) * BigInt(2)).toString();
        await transaction.execute(sql`insert into auth.users (id) values (${ownerId})`);
        await transaction.insert(clients).values({
          id: clientId,
          ownerId,
          firstName: "Total exacto",
        });
        await transaction.insert(charges).values([
          {
            ownerId,
            clientId,
            description: "Máximo uno",
            amountMinor: Number.MAX_SAFE_INTEGER,
            currency: "USD",
            dueDate: "2026-08-01",
            status: "pending",
          },
          {
            ownerId,
            clientId,
            description: "Máximo dos",
            amountMinor: Number.MAX_SAFE_INTEGER,
            currency: "USD",
            dueDate: "2026-08-02",
            status: "pending",
          },
        ]);

        runtime.userId = ownerId;
        runtime.run = createAuthenticatedDrizzleRunner(transaction) as typeof runtime.run;

        const listed = await getClients();
        expect(listed[0]?.outstanding).toEqual({ USD: exactTotal, ARS: "0" });
        await expect(getClientSummary(clientId)).resolves.toMatchObject({
          outstanding: { USD: exactTotal, ARS: "0" },
        });

        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }, 30_000);
});
