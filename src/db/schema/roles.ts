import { pgRole } from "drizzle-orm/pg-core";

export const kazeosBackendRole = pgRole("kazeos_backend", {
  createDb: false,
  createRole: false,
  inherit: true,
});
