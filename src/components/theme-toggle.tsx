"use client";

import { Check, Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

const options = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Laptop },
] as const;

export function ThemeToggle({ onOpen }: { onOpen?: () => void }) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const CurrentIcon =
    options.find((option) => option.value === theme)?.icon ?? Laptop;

  return (
    <div className="menu-anchor" ref={containerRef}>
      <button
        type="button"
        className="icon-button topbar-icon"
        aria-label="Tema"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          onOpen?.();
          setOpen((isOpen) => !isOpen);
        }}
      >
        <CurrentIcon aria-hidden="true" size={19} />
      </button>
      {open ? (
        <div className="overlay-menu theme-menu" role="menu" aria-label="Elegir tema">
          <p className="overlay-menu__label">Apariencia</p>
          {options.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === value}
              onClick={() => {
                setTheme(value);
                setOpen(false);
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
