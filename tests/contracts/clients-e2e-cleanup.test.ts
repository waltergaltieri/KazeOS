// @vitest-environment node

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the authenticated client E2E cleanup contract", () => {
  it("uses a UUID-derived exact marker when the created id was not captured", () => {
    const source = readFileSync(
      new URL("../e2e/clients.spec.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('import { randomUUID } from "node:crypto"');
    expect(source).toContain("const fixtureMarker = randomUUID()");
    expect(source).toMatch(
      /if \(createdClientId\)[\s\S]*delete from clients where id = \$\{createdClientId\}[\s\S]*else[\s\S]*delete from clients[\s\S]*email = \$\{fixtureEmail\}[\s\S]*first_name = \$\{uniqueName\}/,
    );
  });
});
