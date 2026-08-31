// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  buildSupabasePushArgs,
  redactDatabaseCredentials,
} from "./db-migrate";

describe("database migration runner", () => {
  it("uses Supabase migration history through the pinned CLI", () => {
    expect(buildSupabasePushArgs("postgresql://example.invalid/database")).toEqual([
      "db",
      "push",
      "--db-url",
      "postgresql://example.invalid/database",
      "--yes",
    ]);
  });

  it("redacts connection URLs and encoded or decoded passwords from CLI output", () => {
    const databaseUrl =
      "postgresql://postgres:p%40ssword@db.example.invalid/postgres";

    expect(
      redactDatabaseCredentials(
        `failed ${databaseUrl} p%40ssword p@ssword`,
        databaseUrl,
      ),
    ).toBe("failed [REDACTED_DATABASE_URL] [REDACTED] [REDACTED]");
  });

  it("can run the same canonical migration path as a dry-run", () => {
    expect(
      buildSupabasePushArgs("postgresql://example.invalid/database", {
        dryRun: true,
      }),
    ).toEqual([
      "db",
      "push",
      "--db-url",
      "postgresql://example.invalid/database",
      "--yes",
      "--dry-run",
    ]);
  });
});
