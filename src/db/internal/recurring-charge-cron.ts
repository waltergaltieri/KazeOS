import "server-only";

import { generateRecurringCharges } from "@/lib/services/charge-generator";
import { generateRecurringExpenses } from "@/lib/services/expense-generator";

import { adminDb } from "./admin";

/** Trusted server-only facade for the bearer-protected cron route. */
export function runRecurringChargeCron(asOf: string) {
  return adminDb.transaction(async (transaction) => {
    const charges = await generateRecurringCharges(transaction, {
      asOf,
      horizonMonths: 3,
    });
    const expenses = await generateRecurringExpenses(transaction, {
      asOf,
      horizonMonths: 3,
    });

    return { ...charges, expenses };
  });
}
