"use client";

import {
  CheckSquare2,
  CircleDollarSign,
  LayoutDashboard,
  Radar,
  Receipt,
  Settings,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type RefObject, useEffect, useRef } from "react";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients", label: "Clientes", icon: Users },
  { href: "/leadhunter", label: "LeadHunter", icon: Radar },
  { href: "/charges", label: "Cobros", icon: CircleDollarSign },
  { href: "/expenses", label: "Gastos", icon: Receipt },
  { href: "/tasks", label: "Tareas", icon: CheckSquare2 },
  { href: "/settings", label: "Configuración", icon: Settings },
] as const;

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="ledger-navigation" aria-label="Principal">
      <p className="navigation-label">Espacio de trabajo</p>
      <ul>
        {navigation.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                className={active ? "is-active" : undefined}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
              >
                <span className="nav-icon" aria-hidden="true">
                  <Icon size={18} strokeWidth={1.8} />
                </span>
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="brand-lockup" aria-label="KazeOS — Dashboard">
      <span className="brand-mark" aria-hidden="true">K</span>
      <span>
        <strong>KazeOS</strong>
        <small>Gestión diaria</small>
      </span>
    </Link>
  );
}

export function DesktopSidebar() {
  return (
    <aside className="desktop-sidebar">
      <Brand />
      <Navigation />
      <div className="ledger-note">
        <span className="ledger-note__pin" aria-hidden="true" />
        <p>Tu agenda financiera, ordenada movimiento a movimiento.</p>
      </div>
    </aside>
  );
}

const DRAWER_FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function findDesktopNavigationFocusTarget() {
  const sidebar = document.querySelector<HTMLElement>(".desktop-sidebar");

  return (
    sidebar?.querySelector<HTMLElement>('[aria-current="page"]') ??
    sidebar?.querySelector<HTMLElement>(".ledger-navigation a[href]") ??
    sidebar?.querySelector<HTMLElement>(".brand-lockup") ??
    null
  );
}

export function MobileDrawer({
  open,
  onClose,
  returnFocusRef,
}: {
  open: boolean;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const backgroundRegions = Array.from(
      document.querySelectorAll<HTMLElement>(".workspace, .desktop-sidebar"),
    );
    const previouslyInert = backgroundRegions.map((region) =>
      region.hasAttribute("inert"),
    );
    let returnFocusTarget: HTMLElement | null = returnFocusRef.current;
    const desktopQuery = window.matchMedia?.("(min-width: 980px)");
    const closeAtDesktop = (event: { matches: boolean }) => {
      if (event.matches) {
        returnFocusTarget = findDesktopNavigationFocusTarget();
        onClose();
      }
    };
    document.body.style.overflow = "hidden";
    backgroundRegions.forEach((region) => region.setAttribute("inert", ""));
    desktopQuery?.addEventListener("change", closeAtDesktop);
    closeRef.current?.focus();
    if (desktopQuery?.matches) closeAtDesktop({ matches: true });
    return () => {
      desktopQuery?.removeEventListener("change", closeAtDesktop);
      document.body.style.overflow = previousOverflow;
      backgroundRegions.forEach((region, index) => {
        if (!previouslyInert[index]) region.removeAttribute("inert");
      });
      returnFocusTarget?.focus();
    };
  }, [onClose, open, returnFocusRef]);

  function onDrawerKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") return;
    const focusable = Array.from(
      drawerRef.current?.querySelectorAll<HTMLElement>(
        DRAWER_FOCUSABLE_SELECTOR,
      ) ?? [],
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  if (!open) return null;

  return (
    <div className="drawer-layer">
      <button
        className="drawer-scrim"
        type="button"
        tabIndex={-1}
        aria-label="Cerrar menú principal"
        onClick={onClose}
      />
      <aside
        ref={drawerRef}
        className="mobile-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Menú principal"
        onKeyDown={onDrawerKeyDown}
      >
        <div className="drawer-heading">
          <Brand />
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            aria-label="Cerrar menú principal"
            onClick={onClose}
          >
            <X aria-hidden="true" size={20} />
          </button>
        </div>
        <Navigation onNavigate={onClose} />
      </aside>
    </div>
  );
}
