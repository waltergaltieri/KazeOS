import "server-only";

import {
  createAuthenticatedDrizzleRunner,
} from "./authenticated";
import { adminDb } from "./internal/admin";
import { runRecurringChargeCron } from "./internal/recurring-charge-cron";
import {
  claimNextJob,
  completeJob,
  type JobCompletion,
} from "@/lib/services/leadhunter/job-manager";
import { planDueRuns } from "@/lib/services/leadhunter/run-manager";

/**
 * Default application database entry point. The id must come from a verified
 * Supabase `getUser()`/`getClaims()` result, never from request input or
 * user_metadata.
 */
export const withAuthenticatedDb = createAuthenticatedDrizzleRunner(adminDb);

export { runRecurringChargeCron };

const leadHunterLeaseDurationMs = 5 * 60_000;
const leadHunterMaximumAttempts = 3;

export function planDueLeadHunterRuns() {
  return adminDb.transaction((transaction) =>
    planDueRuns(transaction, { now: new Date() }));
}

export function claimLeadHunterJob() {
  return adminDb.transaction((transaction) => claimNextJob(transaction, {
    now: new Date(),
    leaseDurationMs: leadHunterLeaseDurationMs,
    maxAttempts: leadHunterMaximumAttempts,
  }));
}

export function completeLeadHunterJob(input: {
  id: string;
  leaseToken: string;
  completion: JobCompletion;
}) {
  return adminDb.transaction((transaction) => completeJob(transaction, {
    ...input,
    now: new Date(),
    maxAttempts: leadHunterMaximumAttempts,
  }));
}
