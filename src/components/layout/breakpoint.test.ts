// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the shell breakpoint contract", () => {
  it("ends mobile at 979px while desktop begins at 980px", () => {
    const css = readFileSync(
      new URL("../../app/globals.css", import.meta.url),
      "utf8",
    );

    expect(css).toContain("@media (max-width: 979px)");
    expect(css).not.toContain("@media (max-width: 980px)");
  });
});
