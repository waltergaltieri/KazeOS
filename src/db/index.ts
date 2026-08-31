import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";

import { parseEnv } from "@/lib/env";

import { createDatabaseClient, type DatabaseClient } from "./client";

const { DATABASE_URL } = parseEnv(process.env);

type DatabaseGlobal = typeof globalThis & {
  kazeOsDatabaseClient?: DatabaseClient;
};

const databaseGlobal = globalThis as DatabaseGlobal;

export const databaseClient =
  databaseGlobal.kazeOsDatabaseClient ?? createDatabaseClient(DATABASE_URL);

if (process.env.NODE_ENV === "development") {
  databaseGlobal.kazeOsDatabaseClient = databaseClient;
}

export const db = drizzle({ client: databaseClient });
