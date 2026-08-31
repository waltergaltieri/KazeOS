// @vitest-environment node

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { parseSeedConfiguration } from "./seed";

const databaseUrl = "postgresql://postgres:encoded-password@db.example.supabase.co:5432/postgres";
const ownerId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("safe seed configuration", () => {
  it("refuses execution unless demo seeding is explicitly enabled", () => {
    expect(() => parseSeedConfiguration({ DATABASE_URL: databaseUrl, SEED_OWNER_ID: ownerId })).toThrow(/ALLOW_DEMO_SEED=true/);
    expect(() => parseSeedConfiguration({ DATABASE_URL: databaseUrl, SEED_OWNER_ID: ownerId, ALLOW_DEMO_SEED: "TRUE" })).toThrow(/ALLOW_DEMO_SEED=true/);
  });

  it("requires one explicit existing auth owner UUID", () => {
    expect(() => parseSeedConfiguration({ DATABASE_URL: databaseUrl, ALLOW_DEMO_SEED: "true" })).toThrow(/SEED_OWNER_ID/);
    expect(() => parseSeedConfiguration({ DATABASE_URL: databaseUrl, ALLOW_DEMO_SEED: "true", SEED_OWNER_ID: "first-user" })).toThrow(/SEED_OWNER_ID/);
  });

  it("accepts only an explicit opt-in, database URL and owner", () => {
    expect(parseSeedConfiguration({ DATABASE_URL: databaseUrl, ALLOW_DEMO_SEED: "true", SEED_OWNER_ID: ownerId })).toEqual({ databaseUrl, ownerId });
  });
  it("names a missing database URL and never creates or guesses an auth user", () => {
    expect(() => parseSeedConfiguration({ ALLOW_DEMO_SEED: "true", SEED_OWNER_ID: ownerId })).toThrow(/DATABASE_URL/);
    const source = readFileSync(new URL("./seed.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/insert\s+into\s+auth\.users/i);
    expect(source).not.toMatch(/from\s+auth\.users\s+(?:order\s+by|limit)/i);
    expect(source).toMatch(/auth\.users where id/);
  });
});
