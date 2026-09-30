import { z } from "zod";

type EnvironmentInput = Record<string, string | undefined>;

const httpsUrl = z
  .string()
  .min(1, "is required")
  .refine((value) => {
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "must be a valid HTTPS URL");

const postgresqlUrl = z
  .string()
  .min(1, "is required")
  .refine((value) => {
    try {
      const url = new URL(value);

      return (
        url.protocol === "postgresql:" &&
        url.hostname.length > 0 &&
        url.username.length > 0 &&
        url.pathname.length > 1
      );
    } catch {
      return false;
    }
  }, "must be a valid postgresql:// URL");

function getLegacyJwtRole(value: string) {
  const payload = value.split(".")[1];

  if (!payload) {
    return undefined;
  }

  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded)) as { role?: unknown };

    return typeof decoded.role === "string" ? decoded.role : undefined;
  } catch {
    return undefined;
  }
}

const publishableKey = z
  .string()
  .trim()
  .min(1, "is required")
  .refine(
    (value) =>
      /^sb_publishable_[A-Za-z0-9_-]+$/.test(value) ||
      getLegacyJwtRole(value) === "anon",
    "must be a Supabase publishable key or legacy anon key",
  );

const optionalString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(1).optional(),
);

const optionalWorkerSecret = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().trim().min(32, "must contain at least 32 characters").optional(),
);

const optionalHttpsUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  httpsUrl.optional(),
);

export const appOriginSchema = z
  .string()
  .trim()
  .min(1, "is required")
  .refine((value) => {
    try {
      const url = new URL(value);

      return (
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.origin === value
      );
    } catch {
      return false;
    }
  }, "must be a canonical HTTP(S) origin without a path");

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: httpsUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
});

export const serverEnvSchema = z.object({
  DATABASE_URL: postgresqlUrl,
  SUPABASE_JWKS_URL: optionalHttpsUrl,
  SUPABASE_SECRET_KEY: optionalString,
  CRON_SECRET: optionalString,
  LEADHUNTER_WORKER_SECRET: optionalWorkerSecret,
  APP_ORIGIN: appOriginSchema,
});

const envSchema = publicEnvSchema.extend(serverEnvSchema.shape);

export type PublicEnv = z.infer<typeof publicEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;
export type AppEnv = PublicEnv & ServerEnv;

export function parseEnv(input: EnvironmentInput): AppEnv {
  const result = envSchema.safeParse(input);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const field = issue.path.join(".") || "environment";

      return `- ${field}: ${issue.message}`;
    });

    throw new Error(`Invalid environment variables:\n${issues.join("\n")}`);
  }

  return result.data;
}
