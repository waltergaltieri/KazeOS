import "server-only";

import {
  createAuthenticatedDrizzleRunner,
} from "./authenticated";
import { adminDb } from "./internal/admin";
import { runRecurringChargeCron } from "./internal/recurring-charge-cron";
import {
  claimNextJob,
  type JobCompletion,
} from "@/lib/services/leadhunter/job-manager";
import { completeClaimedJob } from "@/lib/services/leadhunter/completion-manager";
import { planDueRuns } from "@/lib/services/leadhunter/run-manager";
import { claimDueMail, recordMailEvent, releaseExpiredMail, settleMail } from "@/lib/services/leadhunter/outbox-manager";
import { prepareValidatedMessage } from "@/lib/services/leadhunter/message-manager";
import { runAgentIdentityResolution, runAgentMessagePreparation } from "@/lib/services/leadhunter/agent-runner";

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

export function claimLeadHunterJob(kinds?: import("@/lib/services/leadhunter/job-manager").JobKind[]) {
  return adminDb.transaction((transaction) => claimNextJob(transaction, {
    now: new Date(),
    leaseDurationMs: leadHunterLeaseDurationMs,
    maxAttempts: leadHunterMaximumAttempts,
    kinds,
  }));
}

export function completeLeadHunterJob(input: {
  id: string;
  leaseToken: string;
  completion: JobCompletion;
}) {
  return adminDb.transaction((transaction) => completeClaimedJob(transaction, {
    ...input,
    now: new Date(),
    maxAttempts: leadHunterMaximumAttempts,
  }));
}

export function prepareLeadHunterMessage(ownerId: string, enrollmentId: string) {
  return adminDb.transaction((transaction) => prepareValidatedMessage(transaction, ownerId, enrollmentId));
}

export function claimLeadHunterMail(leaseOwner: string, limit?: number) {
  return adminDb.transaction(async (transaction) => {
    await releaseExpiredMail(transaction);
    return claimDueMail(transaction, { now: new Date(), leaseOwner, limit });
  });
}

export function settleLeadHunterMail(input: Parameters<typeof settleMail>[1]) {
  return adminDb.transaction((transaction) => settleMail(transaction, input));
}

export function recordLeadHunterMailEvent(input: Parameters<typeof recordMailEvent>[1]) {
  return adminDb.transaction((transaction) => recordMailEvent(transaction, input));
}

export function runLeadHunterIdentityResolution() { return runAgentIdentityResolution(adminDb); }
export function runLeadHunterMessagePreparation() { return runAgentMessagePreparation(adminDb); }
