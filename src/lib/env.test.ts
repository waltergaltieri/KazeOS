// @vitest-environment node

import { describe, expect, it } from "vitest";

import { parseEnv } from "./env";

const validEnv = {
  APP_ORIGIN: "http://127.0.0.1:3000",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
  DATABASE_URL:
    "postgresql://postgres:encoded-password@db.example.supabase.co:5432/postgres",
};

describe("parseEnv", () => {
  it("names every missing required variable in a readable error", () => {
    expect(() => parseEnv({})).toThrowError(
      /NEXT_PUBLIC_SUPABASE_URL[\s\S]*NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY[\s\S]*DATABASE_URL[\s\S]*APP_ORIGIN/,
    );
  });

  it("requires APP_ORIGIN to be a canonical HTTP origin without a path", () => {
    for (const APP_ORIGIN of [
      "https://app.example/path",
      "https://app.example/",
      "javascript:alert(1)",
    ]) {
      expect(() => parseEnv({ ...validEnv, APP_ORIGIN })).toThrowError(
        /APP_ORIGIN/,
      );
    }
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
        LEADHUNTER_WORKER_SECRET: "",
      }),
    ).toEqual({
      ...validEnv,
      SUPABASE_JWKS_URL:
        "https://example.supabase.co/auth/v1/.well-known/jwks.json",
      SUPABASE_SECRET_KEY: undefined,
      CRON_SECRET: undefined,
      LEADHUNTER_WORKER_SECRET: undefined,
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

  it("rejects a configured LeadHunter worker secret shorter than 32 characters", () => {
    expect(() => parseEnv({
      ...validEnv,
      LEADHUNTER_WORKER_SECRET: "too-short",
    })).toThrowError(/LEADHUNTER_WORKER_SECRET/);
  });

  it("rejects a Supabase secret key in the public key variable", () => {
    expect(() =>
      parseEnv({
        ...validEnv,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_example",
      }),
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("rejects a legacy service-role JWT in the public key variable", () => {
    const payload = Buffer.from(
      JSON.stringify({ role: "service_role" }),
    ).toString("base64url");

    expect(() =>
      parseEnv({
        ...validEnv,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `header.${payload}.signature`,
      }),
    ).toThrowError(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
  });

  it("trims optional secrets and treats whitespace as absent", () => {
    expect(
      parseEnv({
        ...validEnv,
        SUPABASE_SECRET_KEY: "   ",
        CRON_SECRET: "  cron-value  ",
        LEADHUNTER_WORKER_SECRET:
          "  worker-secret-with-at-least-32-characters  ",
      }),
    ).toMatchObject({
      SUPABASE_SECRET_KEY: undefined,
      CRON_SECRET: "cron-value",
      LEADHUNTER_WORKER_SECRET:
        "worker-secret-with-at-least-32-characters",
    });
  });
});
