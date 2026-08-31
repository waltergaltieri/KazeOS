"use client";

import { useEffect, useId, useRef, useState } from "react";

const MENU_ITEM_SELECTOR = [
  '[role="menuitem"]:not([disabled]):not([aria-disabled="true"])',
  '[role="menuitemradio"]:not([disabled]):not([aria-disabled="true"])',
  '[role="menuitemcheckbox"]:not([disabled]):not([aria-disabled="true"])',
].join(",");

const DOCUMENT_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

type MenuEdge = "first" | "last";

export function useAccessibleMenu() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusEdgeRef = useRef<MenuEdge>("first");
  const menuId = useId();

  function items() {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? [],
    );
  }

  function openMenu(edge: MenuEdge = "first") {
    focusEdgeRef.current = edge;
    setOpen(true);
  }

  function closeMenu(restoreFocus = false) {
    setOpen(false);
    if (restoreFocus) {
      queueMicrotask(() => triggerRef.current?.focus());
    }
  }

  useEffect(() => {
    if (!open) return;
    const availableItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>(MENU_ITEM_SELECTOR) ?? [],
    );
    const target =
      focusEdgeRef.current === "last"
        ? availableItems[availableItems.length - 1]
        : availableItems[0];
    target?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePointer(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        closeMenu(false);
      }
    }

    document.addEventListener("mousedown", closeOnOutsidePointer);
    return () => document.removeEventListener("mousedown", closeOnOutsidePointer);
  }, [open]);

  function onTriggerClick() {
    if (open) closeMenu(false);
    else openMenu("first");
  }

  function onTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      openMenu("first");
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      openMenu("last");
    }
  }

  function focusOutsideMenu(direction: "forward" | "backward") {
    const allFocusable = Array.from(
      document.querySelectorAll<HTMLElement>(DOCUMENT_FOCUSABLE_SELECTOR),
    );
    const availableItems = items();
    const boundary =
      direction === "forward"
        ? availableItems[availableItems.length - 1]
        : availableItems[0];
    const boundaryIndex = allFocusable.indexOf(boundary);
    const step = direction === "forward" ? 1 : -1;

    for (
      let index = boundaryIndex + step;
      index >= 0 && index < allFocusable.length;
      index += step
    ) {
      const candidate = allFocusable[index];
      if (!menuRef.current?.contains(candidate)) {
        closeMenu(false);
        queueMicrotask(() => candidate.focus());
        return;
      }
    }

    closeMenu(true);
  }

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const availableItems = items();
    if (!availableItems.length) return;

    const currentIndex = Math.max(
      0,
      availableItems.indexOf(document.activeElement as HTMLElement),
    );

    if (event.key === "ArrowDown") {
      event.preventDefault();
      availableItems[(currentIndex + 1) % availableItems.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      availableItems[
        (currentIndex - 1 + availableItems.length) % availableItems.length
      ]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      availableItems[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      availableItems[availableItems.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    } else if (event.key === "Tab") {
      event.preventDefault();
      focusOutsideMenu(event.shiftKey ? "backward" : "forward");
    }
  }

  return {
    open,
    menuId,
    triggerRef,
    menuRef,
    openMenu,
    closeMenu,
    onTriggerClick,
    onTriggerKeyDown,
    onMenuKeyDown,
  };
}
