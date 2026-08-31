import "server-only";

import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { z } from "zod";

import * as schema from "./schema";
import type { DatabaseClient } from "./client";

type TransactionClient = postgres.TransactionSql<Record<string, never>>;
type AuthenticatedDatabase = PostgresJsDatabase<typeof schema>;
type AuthenticatedTransaction = Parameters<
  Parameters<AuthenticatedDatabase["transaction"]>[0]
>[0];
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

export function createAuthenticatedDrizzleRunner(
  database: Pick<AuthenticatedDatabase, "transaction">,
) {
  return async function withAuthenticatedDatabase<TResult>(
    verifiedUserId: string,
    operation: (
      database: AuthenticatedTransaction,
    ) => Promise<TResult> | TResult,
  ) {
    const userId = verifiedUserIdSchema.parse(verifiedUserId);

    return database.transaction(async (transaction) => {
      const claims = JSON.stringify({ sub: userId, role: "authenticated" });

      await transaction.execute(
        sql`select set_config('request.jwt.claims', ${claims}, true)`,
      );
      await transaction.execute(sql.raw("set local role authenticated"));

      return operation(transaction);
    });
  };
}
