// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the client empty-state responsive contract", () => {
  it("spans either empty-state action across the mobile grid without changing other secondary buttons", () => {
    const css = readFileSync(
      new URL("../../app/globals.css", import.meta.url),
      "utf8",
    );
    const mobileStyles = css.slice(css.indexOf("@media (max-width: 720px)"));

    expect(mobileStyles).toMatch(
      /\.client-empty\s*>\s*:is\(\.primary-button,\s*\.secondary-button\)\s*\{[^}]*grid-column:\s*1\s*\/\s*-1;[^}]*width:\s*100%;[^}]*\}/,
    );
    expect(mobileStyles).not.toMatch(
      /(?:^|\n)\s*\.secondary-button\s*\{[^}]*grid-column:/,
    );
  });
});
