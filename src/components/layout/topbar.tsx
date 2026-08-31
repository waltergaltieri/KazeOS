"use client";

import {
  CheckSquare2,
  ChevronDown,
  CircleDollarSign,
  LogOut,
  Menu,
  Plus,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { logout } from "@/lib/auth/actions";

type TopbarProps = {
  user: { name: string; email: string };
  onOpenNavigation: () => void;
};

const quickActions = [
  { href: "/clients/new", label: "Nuevo cliente", icon: UserPlus },
  { href: "/charges/new", label: "Nuevo cobro", icon: CircleDollarSign },
  { href: "/tasks/new", label: "Nueva tarea", icon: CheckSquare2 },
] as const;

export function Topbar({ user, onOpenNavigation }: TopbarProps) {
  const [quickOpen, setQuickOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const quickRef = useRef<HTMLDivElement>(null);
  const userRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      const node = event.target as Node;
      if (!quickRef.current?.contains(node)) setQuickOpen(false);
      if (!userRef.current?.contains(node)) setUserOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setQuickOpen(false);
        setUserOpen(false);
      }
    }
    document.addEventListener("mousedown", closeMenus);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeMenus);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const initials = useMemo(
    () =>
      user.name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "KO",
    [user.name],
  );

  return (
    <header className="topbar">
      <button
        type="button"
        className="icon-button mobile-menu-trigger"
        aria-label="Abrir menú principal"
        onClick={onOpenNavigation}
      >
        <Menu aria-hidden="true" size={21} />
      </button>

      <div className="topbar-context">
        <span className="topbar-kicker">Bitácora comercial</span>
        <span className="topbar-date">Hoy</span>
      </div>

      <div className="topbar-actions">
        <div className="menu-anchor" ref={quickRef}>
          <button
            type="button"
            className="primary-button quick-create-trigger"
            aria-label="Creación rápida"
            aria-haspopup="menu"
            aria-expanded={quickOpen}
            onClick={() => {
              setUserOpen(false);
              setQuickOpen((open) => !open);
            }}
          >
            <Plus aria-hidden="true" size={17} />
            <span>Nuevo</span>
            <ChevronDown aria-hidden="true" size={15} />
          </button>
          {quickOpen ? (
            <div className="overlay-menu quick-menu" role="menu" aria-label="Creación rápida">
              <p className="overlay-menu__label">Crear registro</p>
              {quickActions.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} role="menuitem" onClick={() => setQuickOpen(false)}>
                  <Icon aria-hidden="true" size={17} />
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        <ThemeToggle onOpen={() => {
          setQuickOpen(false);
          setUserOpen(false);
        }} />

        <div className="menu-anchor user-anchor" ref={userRef}>
          <button
            type="button"
            className="user-trigger"
            aria-label={`Cuenta de ${user.name}`}
            aria-haspopup="menu"
            aria-expanded={userOpen}
            onClick={() => {
              setQuickOpen(false);
              setUserOpen((open) => !open);
            }}
          >
            <span className="user-avatar" aria-hidden="true">{initials}</span>
            <span className="user-copy">
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
            <ChevronDown aria-hidden="true" size={15} />
          </button>
          {userOpen ? (
            <div className="overlay-menu user-menu" role="menu" aria-label="Cuenta">
              <div className="user-menu__identity">
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </div>
              <form action={logout}>
                <button type="submit" role="menuitem" className="danger-menu-item">
                  <LogOut aria-hidden="true" size={17} />
                  Cerrar sesión
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
