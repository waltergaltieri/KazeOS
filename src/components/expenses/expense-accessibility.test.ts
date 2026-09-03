import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function tokensFor(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map((match) => [match[1], match[2]]));
}

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("expense ledger accessibility styles", () => {
  it("keeps small muted and semantic badge text at WCAG AA contrast in light and dark themes", () => {
    for (const theme of [tokensFor(":root"), tokensFor(".dark")]) {
      expect(contrast(theme["ink-tertiary"], theme["paper-sheet"])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(theme["ink-tertiary"], theme["paper-canvas"])).toBeGreaterThanOrEqual(4.5);
      for (const [foreground, background] of [
        ["ink-secondary", "paper-inset"],
        ["ink-secondary", "reminder-amber-soft"],
        ["overdue-red", "overdue-red-soft"],
        ["ink-secondary", "collection-green-soft"],
      ] as const) {
        expect(contrast(theme[foreground], theme[background])).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(css).toMatch(/\.expenses-page\s*\{[^}]*--expense-small-muted:\s*var\(--ink-tertiary\)[^}]*--expense-small-semantic:\s*var\(--ink-secondary\)/);
    expect(css).toMatch(/\.expenses-page\s+:is\([^}]*\.client-result-count[^}]*\)\s*\{\s*color:\s*var\(--expense-small-muted\)/);
    expect(css).toMatch(/\.expenses-page\s+:is\([^}]*\.expense-status--planned[^}]*\.expense-status--pending[^}]*\.expense-status--paid[^}]*\.expense-status--cancelled[^}]*\.recurring-expense-status--active[^}]*\.recurring-expense-status--paused[^}]*\.recurring-expense-status--cancelled[^}]*\)\s*\{\s*color:\s*var\(--expense-small-semantic\)/);
  });

  it("keeps mobile recurrence management and edit, cancel and delete targets reachable at 44px", () => {
    expect(css).not.toMatch(/\.recurring-expense-sheet\s*>\s*header\s*>\s*\.secondary-button\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.recurring-expense-sheet\s*>\s*header\s*>\s*\.secondary-button\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.expense-card footer \.expense-command-actions > button\s*\{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.recurring-expense-meta \.icon-button\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/);
  });
});
