"use client";
import { Check, ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";

export type LedgerSelectOption = { value: string; label: string };
export function LedgerSelect({ name, label, options, defaultValue, required, disabled }: { name: string; label: string; options: LedgerSelectOption[]; defaultValue?: string; required?: boolean; disabled?: boolean }) {
  const fallback = defaultValue ?? options[0]?.value ?? ""; const [value, setValue] = useState(fallback); const [open, setOpen] = useState(false); const button = useRef<HTMLButtonElement>(null); const listId = useId(); const selected = options.find((item) => item.value === value);
  function choose(next: string) { setValue(next); setOpen(false); requestAnimationFrame(() => button.current?.focus()); }
  function keyDown(event: React.KeyboardEvent<HTMLDivElement>) { if (event.key === "Escape") { event.preventDefault(); setOpen(false); button.current?.focus(); } const index = Math.max(0, options.findIndex((item) => item.value === value)); if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) { event.preventDefault(); const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : event.key === "ArrowDown" ? Math.min(options.length - 1, index + 1) : Math.max(0, index - 1); setValue(options[next]?.value ?? value); } }
  return <div className="ledger-select" onKeyDown={keyDown}><input type="hidden" name={name} value={value} required={required} /><button ref={button} className="form-control ledger-select__trigger" type="button" disabled={disabled} aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((current) => !current)}><span>{selected?.label ?? "Seleccionar"}</span><ChevronDown size={15} /></button>{open ? <div id={listId} className="ledger-select__options" role="listbox" aria-label={label}>{options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} onClick={() => choose(option.value)}><span>{option.label}</span>{option.value === value ? <Check size={14} /> : null}</button>)}</div> : null}</div>;
}
