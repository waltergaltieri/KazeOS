// @vitest-environment node

import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

const validEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
  DATABASE_URL:
    "postgresql://postgres:encoded-password@db.example.supabase.co:5432/postgres",
};

describe("parseEnv", () => {
  it("names every missing required variable in a readable error", () => {
    expect(() => parseEnv({})).toThrowError(
      /NEXT_PUBLIC_SUPABASE_URL[\s\S]*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY[\s\S]*DATABASE_URL/,
    );
  });

  it("rejects a malformed Supabase URL", () => {
    expect(() =>
      parseEnv({
        ...validEnv,
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
      }),
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("requires the Supabase URL to use HTTPS", () => {
    expect(() =>
      parseEnv({
        ...validEnv,
        NEXT_PUBLIC_SUPABASE_URL: "http://example.supabase.co",
      }),
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("rejects a malformed database URL", () => {
    expect(() =>
      parseEnv({
        ...validEnv,
        DATABASE_URL: "not-a-url",
      }),
    ).toThrowError(/DATABASE_URL/);
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() =>
      parseEnv({
        ...validEnv,
        DATABASE_URL: "https://db.example.supabase.co/postgres",
      }),
    ).toThrowError(/DATABASE_URL/);
  });

  it("accepts valid required values and optional empty secrets", () => {
    expect(
      parseEnv({
        ...validEnv,
        SUPABASE_JWKS_URL:
          "https://example.supabase.co/auth/v1/.well-known/jwks.json",
        SUPABASE_SECRET_KEY: "",
        CRON_SECRET: "",
      }),
    ).toEqual({
      ...validEnv,
      SUPABASE_JWKS_URL:
        "https://example.supabase.co/auth/v1/.well-known/jwks.json",
      SUPABASE_SECRET_KEY: undefined,
      CRON_SECRET: undefined,
    });
  });

  it("validates an optional JWKS URL when provided", () => {
    expect(() =>
      parseEnv({
        ...validEnv,
        SUPABASE_JWKS_URL: "invalid",
      }),
    ).toThrowError(/SUPABASE_JWKS_URL/);
  });
});
