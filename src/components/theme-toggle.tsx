"use client";

import { Check, Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { useAccessibleMenu } from "@/components/ui/use-accessible-menu";

const options = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Laptop },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const {
    open,
    menuId,
    triggerRef,
    menuRef,
    closeMenu,
    onTriggerClick,
    onTriggerKeyDown,
    onMenuKeyDown,
  } = useAccessibleMenu();

  const CurrentIcon =
    options.find((option) => option.value === theme)?.icon ?? Laptop;

  return (
    <div className="menu-anchor">
      <button
        ref={triggerRef}
        type="button"
        className="icon-button topbar-icon"
        aria-label="Tema"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
      >
        <CurrentIcon aria-hidden="true" size={19} />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          className="overlay-menu theme-menu"
          role="menu"
          aria-label="Elegir tema"
          onKeyDown={onMenuKeyDown}
        >
          <p className="overlay-menu__label">Apariencia</p>
          {options.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              tabIndex={-1}
              aria-checked={theme === value}
              onClick={() => {
                setTheme(value);
                closeMenu(true);
              }}
            >
              <Icon aria-hidden="true" size={17} />
              <span>{label}</span>
              {theme === value ? (
                <Check className="menu-check" aria-hidden="true" size={16} />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
