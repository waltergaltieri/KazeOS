import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";

import { parseEnv } from "@/lib/env";

import { createDatabaseClient, type DatabaseClient } from "../client";
import * as schema from "../schema";

const { DATABASE_URL } = parseEnv(process.env);

type DatabaseGlobal = typeof globalThis & {
  kazeOsAdminDatabaseClient?: DatabaseClient;
};

const databaseGlobal = globalThis as DatabaseGlobal;

/**
 * BYPASSRLS connection reserved for migrations and controlled internal work.
 * Application queries must enter through `withAuthenticatedDb` instead.
 */
export const adminDatabaseClient =
  databaseGlobal.kazeOsAdminDatabaseClient ?? createDatabaseClient(DATABASE_URL);

if (process.env.NODE_ENV === "development") {
  databaseGlobal.kazeOsAdminDatabaseClient = adminDatabaseClient;
}

export const adminDb = drizzle({ client: adminDatabaseClient, schema });
