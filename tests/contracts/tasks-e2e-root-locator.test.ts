import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("task E2E root locator contract", () => {
  it("scopes edit to the completed recurring root after a child exists", () => {
    const source = readFileSync(join(process.cwd(), "tests/e2e/tasks.spec.ts"), "utf8");
    expect(source).toContain('const completedRoot = page.getByRole("listitem").filter({');
    expect(source).toContain('has: page.getByRole("checkbox", { name: `Reabrir ${taskTitle}` })');
    expect(source).toContain('completedRoot.getByRole("link", { name: `Editar ${taskTitle}` }).click()');
  });
});
