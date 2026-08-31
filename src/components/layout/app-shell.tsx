"use client";

import { useCallback, useState } from "react";

import { DesktopSidebar, MobileDrawer } from "./sidebar";
import { Topbar } from "./topbar";

type AppShellProps = {
  user: { name: string; email: string };
  children: React.ReactNode;
};

export function AppShell({ user, children }: AppShellProps) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const closeNavigation = useCallback(() => setNavigationOpen(false), []);

  return (
    <div className="app-shell">
      <DesktopSidebar />
      <MobileDrawer open={navigationOpen} onClose={closeNavigation} />
      <div className="workspace">
        <Topbar user={user} onOpenNavigation={() => setNavigationOpen(true)} />
        <main className="workspace-main">{children}</main>
      </div>
    </div>
  );
}
