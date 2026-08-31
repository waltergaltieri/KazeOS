"use client";

import {
  CheckSquare2,
  CircleDollarSign,
  LayoutDashboard,
  Settings,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

const navigation = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/clients", label: "Clientes", icon: Users },
  { href: "/charges", label: "Cobros", icon: CircleDollarSign },
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

export function MobileDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="drawer-layer">
      <button
        className="drawer-scrim"
        type="button"
        aria-label="Cerrar menú principal"
        onClick={onClose}
      />
      <aside
        className="mobile-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Menú principal"
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
