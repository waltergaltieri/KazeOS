import "server-only";

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { z } from "zod";

import * as schema from "./schema";
import type { DatabaseClient } from "./client";

type TransactionClient = postgres.TransactionSql<Record<string, never>>;
type AuthenticatedDatabase = PostgresJsDatabase<typeof schema>;
type DatabaseFactory<TDatabase> = (
  transaction: TransactionClient,
) => TDatabase;

const verifiedUserIdSchema = z
  .string()
  .uuid("A verified user id must be a UUID");

export function createAuthenticatedDatabaseRunner<TDatabase>(
  databaseClient: Pick<DatabaseClient, "begin">,
  createDatabase: DatabaseFactory<TDatabase>,
) {
  return async function withAuthenticatedDatabase<TResult>(
    verifiedUserId: string,
    operation: (database: TDatabase) => Promise<TResult> | TResult,
  ) {
    const userId = verifiedUserIdSchema.parse(verifiedUserId);

    return databaseClient.begin(async (transaction) => {
      const claims = JSON.stringify({ sub: userId, role: "authenticated" });

      await transaction`select set_config('request.jwt.claims', ${claims}, true)`;
      await transaction.unsafe("set local role authenticated");

      return operation(createDatabase(transaction));
    });
  };
}

export const createDrizzleDatabase: DatabaseFactory<AuthenticatedDatabase> = (
  transaction,
) =>
  drizzle({
    // postgres.js transactions are callable query clients but intentionally do
    // not expose connection-lifecycle methods; Drizzle only needs query access.
    client: transaction as unknown as DatabaseClient,
    schema,
  });
