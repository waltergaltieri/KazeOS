import { AppShell } from "@/components/layout/app-shell";
import { requireUser } from "@/lib/auth/require-user";

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
  const user = await requireUser();

  return (
    <AppShell
      user={{
        name: displayName(user),
        email: user.email ?? "Cuenta verificada",
      }}
    >
      {children}
    </AppShell>
  );
}
