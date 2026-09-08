// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("expense E2E cleanup contract", () => {
  it("uses UUID-marked fixtures and deletes exact children before their category", () => {
    const sourceUrl = new URL("../e2e/expenses.spec.ts", import.meta.url);
    const sourcePath = fileURLToPath(sourceUrl);

    expect(existsSync(sourcePath)).toBe(true);
    if (!existsSync(sourcePath)) return;

    const source = readFileSync(sourceUrl, "utf8");

    expect(source).toContain('import { randomUUID } from "node:crypto"');
    expect(source).toContain("const marker = randomUUID()");
    expect(source).toContain("const categoryName = `Aceptación E2E ${marker}`");
    expect(source).toMatch(
      /const fixtureCategories = categoryId[\s\S]*select id from expense_categories[\s\S]*name = \$\{categoryName\}/,
    );

    const deleteExpenses = source.indexOf("delete from expenses where category_id");
    const deleteTemplates = source.indexOf(
      "delete from recurring_expenses where category_id",
      deleteExpenses,
    );
    const deleteCategory = source.indexOf(
      "delete from expense_categories where id",
      deleteTemplates,
    );

    expect(deleteExpenses).toBeGreaterThan(-1);
    expect(deleteTemplates).toBeGreaterThan(deleteExpenses);
    expect(deleteCategory).toBeGreaterThan(deleteTemplates);
    expect(source.slice(deleteCategory)).toContain("name = ${categoryName}");
    expect(source).not.toContain("insert into auth.users");
    expect(source).not.toMatch(/delete from (expenses|recurring_expenses|expense_categories)\s*`?\s*$/m);
  });

  it("pins the acceptance fixtures to explicit currencies", () => {
    const source = readFileSync(
      new URL("../e2e/expenses.spec.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'await choose(page, "Moneda", input.currency ?? "USD")',
    );
  });

  it("serializes browser tests that share the authenticated fixture account", () => {
    const config = readFileSync(
      new URL("../../playwright.config.ts", import.meta.url),
      "utf8",
    );

    expect(config).toMatch(/workers:\s*1[,\n]/);
    expect(config).toContain("fullyParallel: false");
    expect(config).toContain("timeout: 180_000");
    expect(config).toContain("actionTimeout: 30_000");
    expect(config).toContain("navigationTimeout: 30_000");
    expect(config).toContain("expect: { timeout: 30_000 }");
  });

  it("gives the dashboard expense fixture a deterministic movement rank", () => {
    const source = readFileSync(
      new URL("../e2e/dashboard.spec.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('const expenseDueDate = "1900-01-01"');
    expect(source).toContain("${expenseDueDate}, 'pending'");
  });
});
