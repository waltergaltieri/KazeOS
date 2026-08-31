import { pathToFileURL } from "node:url";

import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { z } from "zod";

import { createDatabaseClient } from "./client";
import * as schema from "./schema";
import { seedDemoData } from "./seed-data";

type Environment = Record<string, string | undefined>;

const databaseUrlSchema = z.string().refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "postgresql:" && Boolean(parsed.hostname && parsed.username && parsed.pathname.slice(1));
  } catch { return false; }
}, "DATABASE_URL must be a valid postgresql:// URL");

export function parseSeedConfiguration(environment: Environment) {
  if (environment.ALLOW_DEMO_SEED !== "true") {
    throw new Error("Demo seed refused. Set ALLOW_DEMO_SEED=true explicitly to continue.");
  }
  if (!environment.SEED_OWNER_ID) throw new Error("SEED_OWNER_ID is required and must identify an existing auth user.");
  const owner = z.string().uuid("SEED_OWNER_ID must be an explicit auth user UUID").safeParse(environment.SEED_OWNER_ID);
  if (!owner.success) throw new Error(owner.error.issues[0]?.message ?? "SEED_OWNER_ID is required");
  if (!environment.DATABASE_URL) throw new Error("DATABASE_URL is required for demo seeding.");
  const databaseUrl = databaseUrlSchema.safeParse(environment.DATABASE_URL);
  if (!databaseUrl.success) throw new Error(databaseUrl.error.issues[0]?.message ?? "DATABASE_URL is required");
  return { databaseUrl: databaseUrl.data, ownerId: owner.data };
}

export async function runDemoSeed(environment: Environment = process.env) {
  const { databaseUrl, ownerId } = parseSeedConfiguration(environment);
  const client = createDatabaseClient(databaseUrl);
  const database = drizzle({ client, schema });
  try {
    const existing = await database.execute<{ exists: boolean }>(sql`select exists(select 1 from auth.users where id = ${ownerId}::uuid) as exists`);
    if (!existing[0]?.exists) throw new Error("SEED_OWNER_ID does not identify an existing Supabase auth user.");
    const counts = await database.transaction(async (transaction) => {
      const claims = JSON.stringify({ sub: ownerId, role: "authenticated" });
      await transaction.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
      await transaction.execute(sql.raw("set local role authenticated"));
      return seedDemoData(transaction, ownerId);
    });
    process.stdout.write(`Demo seed completed safely (${Object.values(counts).reduce((total, count) => total + count, 0)} rows reconciled).\n`);
    return counts;
  } finally {
    await client.end();
  }
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : undefined;
if (entrypoint === import.meta.url) {
  config({ path: ".env.local", quiet: true });
  runDemoSeed().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Demo seed failed.";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
