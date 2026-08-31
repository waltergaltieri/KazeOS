import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { parseEnv } from "@/lib/env";

const { DATABASE_URL } = parseEnv(process.env);

export const databaseClient = postgres(DATABASE_URL, { prepare: false });
export const db = drizzle({ client: databaseClient });
