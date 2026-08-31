import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

const authEmail = process.env.E2E_AUTH_EMAIL;
const authPassword = process.env.E2E_AUTH_PASSWORD;
const cleanupDatabase = process.env.DATABASE_URL
  ? postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })
  : undefined;
const ready = Boolean(authEmail && authPassword && cleanupDatabase);

test.afterAll(async () => cleanupDatabase?.end());

test("protects the receivables ledger from unauthenticated access", async ({ page }) => {
  await page.goto("/charges");
  await expect(page).toHaveURL(/\/login\?next=%2Fcharges$/);
});

test.describe("authenticated payment lifecycle", () => {
  test.skip(
    !ready,
    "Pendiente externo: requiere E2E_AUTH_EMAIL, E2E_AUTH_PASSWORD y DATABASE_URL para un usuario real y limpieza exacta.",
  );

  test("creates its own client, records partial and remaining payments, and preserves history", async ({ page }) => {
    const marker = randomUUID();
    const clientName = `Cliente E2E ${marker}`;
    const clientEmail = `e2e-${marker}@example.invalid`;
    const description = `Cobro E2E ${marker}`;
    let clientId: string | undefined;
    let chargeId: string | undefined;

    try {
      await page.goto("/login?next=%2Fclients%2Fnew");
      await page.getByLabel("Email").fill(authEmail!);
      await page.getByLabel("Contraseña", { exact: true }).fill(authPassword!);
      await page.getByRole("button", { name: "Iniciar sesión" }).click();
      await expect(page).toHaveURL(/\/clients\/new$/);

      await page.getByLabel("Nombre *").fill(clientName);
      await page.getByLabel("Empresa").fill(marker);
      await page.getByLabel("Email", { exact: true }).fill(clientEmail);
      await page.getByRole("button", { name: "Guardar cliente" }).click();
      await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/);
      clientId = page.url().match(/\/clients\/([0-9a-f-]+)$/)?.[1];
      expect(clientId).toBeTruthy();
      const createdClientId = clientId!;

      await page.goto(`/charges/new?clientId=${createdClientId}`);
      await expect(page.getByText(clientName, { exact: false })).toBeVisible();
      await page.getByLabel("Concepto *").fill(description);
      await page.getByLabel("Monto *").fill("100,00");
      await page.getByLabel("Vencimiento *").fill("2026-09-15");
      await page.getByRole("button", { name: "Guardar cobro" }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${createdClientId}/charges$`));

      const rows = await cleanupDatabase!`
        select id from charges
        where client_id = ${createdClientId}
          and description = ${description}
          and generated_automatically = false
      `;
      expect(rows).toHaveLength(1);
      chargeId = rows[0]?.id as string;
      const createdChargeId = chargeId;

      const chargeContainer = () => page
        .getByText(description)
        .first()
        .locator("xpath=ancestor::tr | ancestor::article")
        .first();

      await expect(chargeContainer()).toBeVisible();
      await chargeContainer().getByRole("button", { name: /Cobrar|Registrar pago/ }).click();
      await page.getByLabel("Monto").fill("40,00");
      await page.getByRole("button", { name: "Registrar pago" }).click();
      await expect.poll(async () => Number((await cleanupDatabase!`
        select amount_paid_minor from charges where id = ${createdChargeId}
      `)[0]?.amount_paid_minor)).toBe(4_000);

      await expect(chargeContainer()).toBeVisible();
      await chargeContainer().getByRole("button", { name: /Cobrar|Registrar pago/ }).click();
      await page.getByLabel("Monto").fill("60,00");
      await page.getByRole("button", { name: "Registrar pago" }).click();
      await expect.poll(async () => Number((await cleanupDatabase!`
        select amount_paid_minor from charges where id = ${createdChargeId}
      `)[0]?.amount_paid_minor)).toBe(10_000);

      await page.goto(`/charges/${createdChargeId}`);
      await expect(page.getByRole("heading", { name: "Historial de pagos" })).toBeVisible();
      await expect(page.getByText("USD 40,00")).toBeVisible();
      await expect(page.getByText("USD 60,00")).toBeVisible();
      await expect(page.getByRole("button", { name: "Corregir pago de USD 40,00" })).toBeVisible();
    } finally {
      if (cleanupDatabase) {
        const fixtureClients = clientId
          ? [{ id: clientId }]
          : await cleanupDatabase`
              select id from clients
              where first_name = ${clientName}
                and company = ${marker}
                and email = ${clientEmail}
            `;

        for (const client of fixtureClients) {
          await cleanupDatabase`delete from payments where client_id = ${client.id}`;
          await cleanupDatabase`
            delete from charges
            where client_id = ${client.id}
              and description = ${description}
          `;
          await cleanupDatabase`
            delete from clients
            where id = ${client.id}
              and first_name = ${clientName}
              and company = ${marker}
              and email = ${clientEmail}
          `;
        }
      }
    }
  });
});
