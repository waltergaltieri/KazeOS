import postgres from "postgres";

export const databaseClientOptions = {
  prepare: false,
  max: 1,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
} as const;

type PostgresFactory<TClient> = (
  databaseUrl: string,
  options: typeof databaseClientOptions,
) => TClient;

export type DatabaseClient = postgres.Sql<Record<string, never>>;

export function createDatabaseClient(databaseUrl: string): DatabaseClient;
export function createDatabaseClient<TClient>(
  databaseUrl: string,
  factory: PostgresFactory<TClient>,
): TClient;
export function createDatabaseClient<TClient>(
  databaseUrl: string,
  factory?: PostgresFactory<TClient>,
) {
  return factory
    ? factory(databaseUrl, databaseClientOptions)
    : postgres(databaseUrl, databaseClientOptions);
}
