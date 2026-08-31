import "server-only";

import {
  createAuthenticatedDatabaseRunner,
  createDrizzleDatabase,
} from "./authenticated";
import { adminDatabaseClient } from "./internal/admin";

/**
 * Default application database entry point. The id must come from a verified
 * Supabase `getUser()`/`getClaims()` result, never from request input or
 * user_metadata.
 */
export const withAuthenticatedDb = createAuthenticatedDatabaseRunner(
  adminDatabaseClient,
  createDrizzleDatabase,
);
