import "server-only";

import { eq } from "drizzle-orm";

import { withAuthenticatedDb } from "@/db";
import { profiles, settings } from "@/db/schema";
import { requireUser } from "@/lib/auth/require-user";

export interface UserSettings {
  profile: { fullName: string; email: string };
  business: {
    primaryCurrency: "USD" | "ARS";
    timezone: "America/Argentina/Buenos_Aires";
    locale: "es-AR";
    businessName: string | null;
    businessInfo: string | null;
  };
}

export async function getSettings(): Promise<UserSettings> {
  const user = await requireUser();
  const result = await withAuthenticatedDb(user.id, async (database) => {
    const [profileRows, businessRows] = await Promise.all([
      database.select({ fullName: profiles.fullName, email: profiles.email }).from(profiles).where(eq(profiles.id, user.id)).limit(1),
      database.select({ primaryCurrency: settings.primaryCurrency, timezone: settings.timezone, locale: settings.locale, businessName: settings.businessName, businessInfo: settings.businessInfo }).from(settings).where(eq(settings.ownerId, user.id)).limit(1),
    ]);
    return { profile: profileRows[0] ?? null, business: businessRows[0] ?? null };
  });
  const email = user.email ?? result.profile?.email ?? "Cuenta verificada";
  return {
    profile: { fullName: (result.profile?.fullName ?? email.split("@")[0]) || "Administrador", email },
    business: {
      primaryCurrency: result.business?.primaryCurrency ?? "USD",
      timezone: "America/Argentina/Buenos_Aires",
      locale: "es-AR",
      businessName: result.business?.businessName ?? null,
      businessInfo: result.business?.businessInfo ?? null,
    },
  };
}
