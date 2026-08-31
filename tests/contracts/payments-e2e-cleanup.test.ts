// @vitest-environment node
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("payment E2E cleanup contract", () => {
  it("creates a UUID-marked client and cleans children before the exact client, with a pre-redirect fallback", () => {
    const source = readFileSync(
      new URL("../e2e/payments.spec.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const marker = randomUUID()");
    expect(source).toMatch(
      /const fixtureClients = clientId[\s\S]*select id from clients[\s\S]*first_name = \$\{clientName\}[\s\S]*company = \$\{marker\}[\s\S]*email = \$\{clientEmail\}/,
    );

    const deletePayments = source.indexOf("delete from payments where client_id");
    const deleteCharges = source.indexOf("delete from charges", deletePayments);
    const deleteClient = source.indexOf("delete from clients", deleteCharges);
    expect(deletePayments).toBeGreaterThan(-1);
    expect(deleteCharges).toBeGreaterThan(deletePayments);
    expect(deleteClient).toBeGreaterThan(deleteCharges);
    expect(source.slice(deleteClient)).toMatch(
      /id = \$\{client\.id\}[\s\S]*first_name = \$\{clientName\}[\s\S]*company = \$\{marker\}[\s\S]*email = \$\{clientEmail\}/,
    );
    expect(source).not.toContain("insert into auth.users");
  });
});
