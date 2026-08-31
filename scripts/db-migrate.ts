import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { config } from "dotenv";

import { parseEnv } from "../src/lib/env";

const require = createRequire(import.meta.url);
const supabaseCliPath = require.resolve("supabase/dist/supabase.js");

type MigrationOptions = {
  dryRun?: boolean;
};

export function buildSupabasePushArgs(
  databaseUrl: string,
  { dryRun = false }: MigrationOptions = {},
) {
  const args = [
    "db",
    "push",
    "--db-url",
    databaseUrl,
    "--yes",
  ];

  if (dryRun) {
    args.push("--dry-run");
  }

  return args;
}

export function redactDatabaseCredentials(
  output: string,
  databaseUrl: string,
) {
  let redacted = output.replace(
    /postgres(?:ql)?:\/\/[^\s'"`]+/giu,
    "[REDACTED_DATABASE_URL]",
  );

  try {
    const encodedPassword = new URL(databaseUrl).password;
    const decodedPassword = decodeURIComponent(encodedPassword);

    for (const password of [encodedPassword, decodedPassword]) {
      if (password) {
        redacted = redacted.replaceAll(password, "[REDACTED]");
      }
    }
  } catch {
    // parseEnv validates this before execution; redaction stays best-effort.
  }

  return redacted;
}

type SpawnDatabaseMigration = (
  command: string,
  args: string[],
  options: {
    stdio: "pipe";
    encoding: "utf8";
    windowsHide: true;
  },
) => SpawnSyncReturns<string>;

export function runDatabaseMigration(
  spawnDatabaseMigration: SpawnDatabaseMigration = spawnSync,
  options: MigrationOptions = {},
) {
  config({ path: ".env.local", quiet: true });
  const { DATABASE_URL } = parseEnv(process.env);
  const result = spawnDatabaseMigration(
    process.execPath,
    [supabaseCliPath, ...buildSupabasePushArgs(DATABASE_URL, options)],
    { stdio: "pipe", encoding: "utf8", windowsHide: true },
  );

  if (result.stdout) {
    process.stdout.write(redactDatabaseCredentials(result.stdout, DATABASE_URL));
  }
  if (result.stderr) {
    process.stderr.write(redactDatabaseCredentials(result.stderr, DATABASE_URL));
  }

  if (result.error) {
    throw new Error("Unable to start the Supabase migration CLI");
  }
  if (result.status !== 0) {
    throw new Error(`Supabase migration failed with exit code ${result.status}`);
  }
}

const entrypoint = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (entrypoint === import.meta.url) {
  runDatabaseMigration(spawnSync, {
    dryRun: process.argv.includes("--dry-run"),
  });
}
