import "server-only";

import { generateRecurringCharges } from "@/lib/services/charge-generator";

import { adminDb } from "./admin";

/** Trusted server-only facade for the bearer-protected cron route. */
export function runRecurringChargeCron(asOf: string) {
  return adminDb.transaction((transaction) =>
    generateRecurringCharges(transaction, { asOf, horizonMonths: 3 }),
  );
}
