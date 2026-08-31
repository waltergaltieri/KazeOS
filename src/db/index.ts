import "server-only";

import {
  createAuthenticatedDrizzleRunner,
} from "./authenticated";
import { adminDb } from "./internal/admin";
import { runRecurringChargeCron } from "./internal/recurring-charge-cron";

/**
 * Default application database entry point. The id must come from a verified
 * Supabase `getUser()`/`getClaims()` result, never from request input or
 * user_metadata.
 */
export const withAuthenticatedDb = createAuthenticatedDrizzleRunner(adminDb);

export { runRecurringChargeCron };
