"use client";

import {
  CheckSquare2,
  ChevronDown,
  CircleDollarSign,
  LogOut,
  Menu,
  Plus,
  Receipt,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { type RefObject, useMemo } from "react";

import { ThemeToggle } from "@/components/theme-toggle";
import { useAccessibleMenu } from "@/components/ui/use-accessible-menu";
import type { Currency } from "@/lib/domain/money";
import {
  CURRENCY_PREFERENCE_COOKIE,
  CURRENCY_PREFERENCE_MAX_AGE,
  resolveCurrencyPreference,
} from "@/lib/preferences/currency";

type TopbarProps = {
  user: { name: string; email: string };
  initialCurrency?: Currency;
  onOpenNavigation: () => void;
  navigationTriggerRef: RefObject<HTMLButtonElement | null>;
};

const quickActions = [
  { href: "/clients/new", label: "Nuevo cliente", icon: UserPlus },
  { href: "/charges/new", label: "Nuevo cobro", icon: CircleDollarSign },
  { href: "/expenses/new", label: "Nuevo gasto", icon: Receipt },
  { href: "/tasks/new", label: "Nueva tarea", icon: CheckSquare2 },
] as const;

function currencyHref(
  pathname: string,
  searchParams: Pick<URLSearchParams, "toString">,
  currency: Currency,
) {
  const query = new URLSearchParams(searchParams.toString());
  query.set("currency", currency);
  query.delete("page");
  return `${pathname}?${query.toString()}`;
}

function rememberCurrency(currency: Currency) {
  document.cookie = `${CURRENCY_PREFERENCE_COOKIE}=${currency}; Path=/; Max-Age=${CURRENCY_PREFERENCE_MAX_AGE}; SameSite=Lax`;
}

export function Topbar({ user, initialCurrency, onOpenNavigation, navigationTriggerRef }: TopbarProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const selectedCurrency = resolveCurrencyPreference(
    searchParams.get("currency"),
    initialCurrency,
  );
  const {
    open: quickOpen,
    menuId: quickMenuId,
    triggerRef: quickTriggerRef,
    menuRef: quickMenuRef,
    closeMenu: closeQuickMenu,
    onTriggerClick: onQuickTriggerClick,
    onTriggerKeyDown: onQuickTriggerKeyDown,
    onMenuKeyDown: onQuickMenuKeyDown,
  } = useAccessibleMenu();
  const {
    open: userOpen,
    menuId: userMenuId,
    triggerRef: userTriggerRef,
    menuRef: userMenuRef,
    onTriggerClick: onUserTriggerClick,
    onTriggerKeyDown: onUserTriggerKeyDown,
    onMenuKeyDown: onUserMenuKeyDown,
  } = useAccessibleMenu();

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
        ref={navigationTriggerRef}
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
        {pathname === "/dashboard" || pathname === "/expenses" ? (
          <nav className="dashboard-currency-selector" aria-label="Moneda del resumen" role="group">
            {(["USD", "ARS"] as const).map((currency) => (
              <Link
                key={currency}
                href={currencyHref(pathname, searchParams, currency)}
                className={selectedCurrency === currency ? "is-active" : undefined}
                aria-current={selectedCurrency === currency ? "true" : undefined}
                onClick={() => rememberCurrency(currency)}
              >
                {currency}
              </Link>
            ))}
          </nav>
        ) : null}
        <div className="menu-anchor">
          <button
            ref={quickTriggerRef}
            type="button"
            className="primary-button quick-create-trigger"
            aria-label="Creación rápida"
            aria-haspopup="menu"
            aria-expanded={quickOpen}
            aria-controls={quickOpen ? quickMenuId : undefined}
            onClick={onQuickTriggerClick}
            onKeyDown={onQuickTriggerKeyDown}
          >
            <Plus aria-hidden="true" size={17} />
            <span>Nuevo</span>
            <ChevronDown aria-hidden="true" size={15} />
          </button>
          {quickOpen ? (
            <div
              ref={quickMenuRef}
              id={quickMenuId}
              className="overlay-menu quick-menu"
              role="menu"
              aria-label="Creación rápida"
              onKeyDown={onQuickMenuKeyDown}
            >
              <p className="overlay-menu__label">Crear registro</p>
              {quickActions.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  role="menuitem"
                  tabIndex={-1}
                  onClick={() => closeQuickMenu(false)}
                >
                  <Icon aria-hidden="true" size={17} />
                  <span>{label}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        <ThemeToggle />

        <div className="menu-anchor user-anchor">
          <button
            ref={userTriggerRef}
            type="button"
            className="user-trigger"
            aria-label={`Cuenta de ${user.name}`}
            aria-haspopup="menu"
            aria-expanded={userOpen}
            aria-controls={userOpen ? userMenuId : undefined}
            onClick={onUserTriggerClick}
            onKeyDown={onUserTriggerKeyDown}
          >
            <span className="user-avatar" aria-hidden="true">{initials}</span>
            <span className="user-copy">
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
            <ChevronDown aria-hidden="true" size={15} />
          </button>
          {userOpen ? (
            <div
              ref={userMenuRef}
              id={userMenuId}
              className="overlay-menu user-menu"
              role="menu"
              aria-label="Cuenta"
              onKeyDown={onUserMenuKeyDown}
            >
              <div className="user-menu__identity">
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </div>
              <form action="/auth/logout" method="post">
                <button
                  type="submit"
                  role="menuitem"
                  tabIndex={-1}
                  className="danger-menu-item"
                >
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
