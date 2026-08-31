import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import postgres from "postgres";
config({ path: ".env.local", quiet: true });
const authEmail = process.env.E2E_AUTH_EMAIL; const authPassword = process.env.E2E_AUTH_PASSWORD; const cleanupDatabase = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL, { prepare: false, max: 1 }) : undefined; const ready = Boolean(authEmail && authPassword && cleanupDatabase);
test.afterAll(async () => cleanupDatabase?.end());
test("protects the receivables ledger from unauthenticated access", async ({ page }) => { await page.goto("/charges"); await expect(page).toHaveURL(/\/login\?next=%2Fcharges$/); });
test.describe("authenticated payment lifecycle", () => {
  test.skip(!ready, "Pendiente externo: requiere E2E_AUTH_EMAIL, E2E_AUTH_PASSWORD y DATABASE_URL para un usuario real y limpieza exacta.");
  test("creates a manual charge and preserves its payment movement", async ({ page }) => {
    const marker = randomUUID(); const description = `Cobro E2E ${marker}`; let chargeId: string | undefined;
    try {
      await page.goto("/login?next=%2Fcharges"); await page.getByLabel("Email").fill(authEmail!); await page.getByLabel("Contraseña", { exact: true }).fill(authPassword!); await page.getByRole("button", { name: "Iniciar sesión" }).click(); await expect(page).toHaveURL(/\/charges$/);
      await page.getByRole("link", { name: "Nuevo cobro" }).click(); await page.getByRole("button", { name: "Cliente" }).click(); const firstClient = page.getByRole("option").first(); await expect(firstClient).toBeVisible(); await firstClient.click(); await page.getByLabel("Concepto *").fill(description); await page.getByLabel("Monto *").fill("100,00"); await page.getByLabel("Vencimiento *").fill("2026-09-15"); await page.getByRole("button", { name: "Guardar cobro" }).click(); await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+\/charges$/);
      const rows = await cleanupDatabase!`select id from charges where description = ${description} and generated_automatically = false`; expect(rows).toHaveLength(1); const createdChargeId = rows[0]?.id as string; chargeId = createdChargeId;
      const cardOrRow = page.getByText(description).first(); await expect(cardOrRow).toBeVisible(); const container = cardOrRow.locator("xpath=ancestor::tr | ancestor::article").first(); await container.getByRole("button", { name: /Cobrar|Registrar pago/ }).click(); await page.getByLabel("Monto").fill("40,00"); await page.getByRole("button", { name: "Registrar pago" }).click(); await expect.poll(async () => Number((await cleanupDatabase!`select amount_paid_minor from charges where id = ${createdChargeId}`)[0]?.amount_paid_minor)).toBe(4000);
      await page.goto(`/charges/${createdChargeId}`); await expect(page.getByRole("heading", { name: "Historial de pagos" })).toBeVisible(); await expect(page.getByText("USD 40,00")).toBeVisible();
    } finally {
      const rows = chargeId ? [{ id: chargeId }] : await cleanupDatabase!`select id from charges where description = ${description} and generated_automatically = false`;
      for (const row of rows) { await cleanupDatabase!`delete from payments where charge_id = ${row.id}`; await cleanupDatabase!`delete from charges where id = ${row.id} and description = ${description}`; }
    }
  });
});
