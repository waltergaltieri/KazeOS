import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

import { parseEnv } from "./src/lib/env";

config({ path: ".env.local" });

const { DATABASE_URL } = parseEnv(process.env);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./supabase/migrations",
  dbCredentials: {
    url: DATABASE_URL,
  },
});
