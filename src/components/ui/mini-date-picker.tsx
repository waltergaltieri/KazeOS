"use client";

import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

export function MiniDatePicker({
  name = "dueDate",
  label = "Vencimiento",
  defaultValue = "",
  error,
  required = true,
  onValueChange,
}: {
  name?: string;
  label?: string;
  defaultValue?: string;
  error?: string;
  required?: boolean;
  onValueChange?: (value: string) => void;
}) {
  const initialDate = defaultValue ? parseISO(defaultValue) : null;
  const [selected, setSelected] = useState(defaultValue);
  const [month, setMonth] = useState(initialDate ?? new Date());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const errorId = `${id}-error`;
  const requiredId = `${id}-required`;
  const describedBy = [required ? requiredId : null, error ? errorId : null]
    .filter(Boolean)
    .join(" ") || undefined;
  const days = useMemo(
    () => eachDayOfInterval({
      start: startOfWeek(startOfMonth(month), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(month), { weekStartsOn: 1 }),
    }),
    [month],
  );

  return (
    <div
      ref={rootRef}
      className="mini-date-picker"
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        className="form-control mini-date-picker__trigger"
        type="button"
        aria-label={`${label}: ${selected ? format(parseISO(selected), "dd/MM/yyyy") : "sin fecha"}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={describedBy}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{selected ? format(parseISO(selected), "dd/MM/yyyy") : "dd/mm/aaaa"}</span>
        <CalendarDays size={17} aria-hidden="true" />
      </button>
      <input type="hidden" name={name} value={selected} />
      {required ? <span id={requiredId} className="sr-only">Campo obligatorio.</span> : null}
      {open ? (
        <div className="mini-calendar" role="dialog" aria-label={`Seleccionar ${label.toLowerCase()}`}>
          <header>
            <button type="button" className="icon-button" aria-label="Mes anterior" onClick={() => setMonth((value) => subMonths(value, 1))}>
              <ChevronLeft size={16} aria-hidden="true" />
            </button>
            <strong>{format(month, "LLLL yyyy", { locale: es })}</strong>
            <button type="button" className="icon-button" aria-label="Mes siguiente" onClick={() => setMonth((value) => addMonths(value, 1))}>
              <ChevronRight size={16} aria-hidden="true" />
            </button>
          </header>
          <div className="mini-calendar__weekdays" aria-hidden="true">
            {['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="mini-calendar__days">
            {days.map((day) => {
              const iso = format(day, "yyyy-MM-dd");
              const active = selected ? isSameDay(day, parseISO(selected)) : false;
              return (
                <button
                  key={iso}
                  type="button"
                  aria-label={format(day, "dd/MM/yyyy")}
                  aria-pressed={active}
                  className={`${isSameMonth(day, month) ? "" : "is-outside"}${active ? " is-selected" : ""}`.trim()}
                  onClick={() => {
                    setSelected(iso);
                    onValueChange?.(iso);
                    setOpen(false);
                  }}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {!required && selected ? (
        <button
          type="button"
          className="quiet-button"
          aria-label={`Quitar fecha de ${label.toLowerCase()}`}
          onClick={() => {
            setSelected("");
            onValueChange?.("");
          }}
        >
          Sin fecha
        </button>
      ) : null}
      {error ? <small id={errorId} className="field-error">{error}</small> : null}
    </div>
  );
}
