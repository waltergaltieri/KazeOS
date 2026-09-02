"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

export type LedgerSelectOption = { value: string; label: string };

interface LedgerSelectProps {
  name: string;
  label: string;
  options: LedgerSelectOption[];
  defaultValue?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  onValueChange?: (value: string) => void;
}

export function LedgerSelect({
  name,
  label,
  options,
  defaultValue,
  required,
  disabled,
  error,
  onValueChange,
}: LedgerSelectProps) {
  const fallback = defaultValue ?? options[0]?.value ?? "";
  const [value, setValue] = useState(fallback);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const listId = `${id}-listbox`;
  const errorId = `${id}-error`;
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options[selectedIndex];

  useEffect(() => {
    if (open) listboxRef.current?.focus();
  }, [open]);

  function openListbox(initialIndex = selectedIndex) {
    if (disabled || options.length === 0) return;
    setActiveIndex(initialIndex);
    setOpen(true);
  }

  function closeListbox(restoreTrigger: boolean) {
    setOpen(false);
    if (restoreTrigger) triggerRef.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    setValue(option.value);
    onValueChange?.(option.value);
    closeListbox(true);
  }

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openListbox(event.key === "ArrowUp" ? options.length - 1 : selectedIndex);
    }
  }

  function onListboxKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeListbox(true);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      setOpen(false);
      const focusable = Array.from(
        document.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const triggerIndex = triggerRef.current
        ? focusable.indexOf(triggerRef.current)
        : -1;
      const targetIndex = event.shiftKey ? triggerIndex - 1 : triggerIndex + 1;
      focusable[targetIndex]?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(activeIndex);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    event.preventDefault();
    setActiveIndex((current) => {
      if (event.key === "Home") return 0;
      if (event.key === "End") return options.length - 1;
      if (event.key === "ArrowDown") return Math.min(options.length - 1, current + 1);
      return Math.max(0, current - 1);
    });
  }

  return (
    <div
      ref={rootRef}
      className="ledger-select"
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <input type="hidden" name={name} value={value} disabled={disabled} />
      <button
        ref={triggerRef}
        className="form-control ledger-select__trigger"
        type="button"
        role="combobox"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-required={required || undefined}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={error ? errorId : undefined}
        onKeyDown={onTriggerKeyDown}
        onClick={() => (open ? closeListbox(false) : openListbox())}
      >
        <span>{selected?.label ?? "Seleccionar"}</span>
        <ChevronDown size={15} />
      </button>
      {error ? <span id={errorId} className="sr-only">{error}</span> : null}
      {open ? (
        <div
          ref={listboxRef}
          id={listId}
          className="ledger-select__options"
          role="listbox"
          aria-label={label}
          aria-activedescendant={`${id}-option-${activeIndex}`}
          tabIndex={-1}
          onKeyDown={onListboxKeyDown}
        >
          {options.map((option, index) => (
            <div
              id={`${id}-option-${index}`}
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={index === activeIndex ? "is-active" : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={14} /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
