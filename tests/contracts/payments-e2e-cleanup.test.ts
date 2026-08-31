// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
describe("payment E2E cleanup contract", () => { it("uses an exact UUID marker and deletes payment children before the marked charge", () => { const source = readFileSync(new URL("../e2e/payments.spec.ts", import.meta.url), "utf8"); expect(source).toContain("const marker = randomUUID()"); expect(source).toMatch(/delete from payments where charge_id = \$\{row\.id\}[\s\S]*delete from charges where id = \$\{row\.id\} and description = \$\{description\}/); expect(source).not.toContain("insert into auth.users"); }); });
