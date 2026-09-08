import { cookies } from "next/headers";

import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/require-user";
import {
  CURRENCY_PREFERENCE_COOKIE,
  resolveCurrencyPreference,
} from "@/lib/preferences/currency";

function displayName(user: Awaited<ReturnType<typeof requireUser>>) {
  const metadataName = user.user_metadata?.full_name;

  if (typeof metadataName === "string" && metadataName.trim()) {
    return metadataName.trim();
  }

  return user.email?.split("@")[0] || "Administrador";
}

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const [user, cookieStore] = await Promise.all([requireUser(), cookies()]);
  const initialCurrency = resolveCurrencyPreference(
    undefined,
    cookieStore.get(CURRENCY_PREFERENCE_COOKIE)?.value,
  );

  return (
    <AppShell
      user={{
        name: displayName(user),
        email: user.email ?? "Cuenta verificada",
      }}
      initialCurrency={initialCurrency}
    >
      {children}
    </AppShell>
  );
}
