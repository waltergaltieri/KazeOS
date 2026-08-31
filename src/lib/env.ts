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

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalHttpsUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  httpsUrl.optional(),
);

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: httpsUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1, "is required"),
});

export const serverEnvSchema = z.object({
  DATABASE_URL: postgresqlUrl,
  SUPABASE_JWKS_URL: optionalHttpsUrl,
  SUPABASE_SECRET_KEY: optionalString,
  CRON_SECRET: optionalString,
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
