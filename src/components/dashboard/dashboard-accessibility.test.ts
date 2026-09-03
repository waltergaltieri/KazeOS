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

function rule(selector: string) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("dashboard financial accessibility styles", () => {
  it("keeps dashboard auxiliary and KPI labels at 12px or larger with AA contrast", () => {
    for (const theme of [tokensFor(":root"), tokensFor(".dark")]) {
      for (const background of ["paper-canvas", "paper-sheet", "paper-inset"] as const) {
        expect(contrast(theme["ink-secondary"], theme[background]), `ink-secondary on ${background}`)
          .toBeGreaterThanOrEqual(4.5);
      }
    }

    for (const selector of [
      ".dashboard-kpi h2",
      ".dashboard-kpi p",
      ".dashboard-count-card p",
      ".dashboard-panel__heading .eyebrow",
      ".dashboard-panel__heading > a",
      ".dashboard-comparison-row dt",
      ".dashboard-comparison-note",
    ]) {
      expect(rule(selector), selector).toMatch(/color:\s*var\(--ink-secondary\)/);
      expect(rule(selector), selector).toMatch(/font-size:\s*(?:1[2-9]|[2-9]\d)px/);
    }
  });
});
