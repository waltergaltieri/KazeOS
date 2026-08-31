"use client";

import { useCallback, useRef, useState } from "react";

import { DesktopSidebar, MobileDrawer } from "./sidebar";
import { Topbar } from "./topbar";

type AppShellProps = {
  user: { name: string; email: string };
  children: React.ReactNode;
};

export function AppShell({ user, children }: AppShellProps) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationTriggerRef = useRef<HTMLButtonElement>(null);
  const closeNavigation = useCallback(() => setNavigationOpen(false), []);

  return (
    <div className="app-shell">
      <DesktopSidebar />
      <MobileDrawer
        open={navigationOpen}
        onClose={closeNavigation}
        returnFocusRef={navigationTriggerRef}
      />
      <div className="workspace">
        <Topbar
          user={user}
          onOpenNavigation={() => setNavigationOpen(true)}
          navigationTriggerRef={navigationTriggerRef}
        />
        <main className="workspace-main">{children}</main>
      </div>
    </div>
  );
}
