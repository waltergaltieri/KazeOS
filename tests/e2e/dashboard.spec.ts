import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import postgres from "postgres";

import { todayInBusinessZone } from "../../src/lib/domain/commercial-date";

config({ path: ".env.local", quiet: true });

const authEmail = process.env.E2E_AUTH_EMAIL;
const authPassword = process.env.E2E_AUTH_PASSWORD;
const database = process.env.DATABASE_URL
  ? postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })
  : undefined;
const ready = Boolean(authEmail && authPassword && database);

test.afterAll(async () => database?.end());

test("protects the business dashboard from unauthenticated access", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  await expect(page.getByRole("heading", { name: "Bienvenido de nuevo" })).toBeVisible();
});

test.describe("authenticated dashboard summary", () => {
  test.skip(
    !ready,
    "Pendiente externo: requiere E2E_AUTH_EMAIL, E2E_AUTH_PASSWORD y DATABASE_URL; no se crea ningún usuario de Auth.",
  );

  test("renders its own exact client, receivable, payment and task fixture", async ({ page }) => {
    const marker = randomUUID();
    const clientName = `Dashboard E2E ${marker}`;
    const clientEmail = `dashboard-${marker}@example.invalid`;
    const chargeId = randomUUID();
    const paymentId = randomUUID();
    const taskId = randomUUID();
    const expenseCategoryId = randomUUID();
    const expenseId = randomUUID();
    const expenseTitle = `Gasto dashboard ${marker}`;
    const today = todayInBusinessZone(new Date());
    let clientId: string | undefined;

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

      const owner = await database!`select owner_id from clients where id = ${clientId!}`;
      expect(owner).toHaveLength(1);
      const ownerId = owner[0]!.owner_id as string;

      await database!`
        insert into charges (id, owner_id, client_id, description, amount_minor, currency, due_date)
        values (${chargeId}, ${ownerId}, ${clientId!}, ${`Cobro ${marker}`}, 32123, 'USD', ${today})
      `;
      await database!`
        insert into payments (id, owner_id, client_id, amount_minor, currency, payment_date, payment_method, reference)
        values (${paymentId}, ${ownerId}, ${clientId!}, 45678, 'USD', ${today}, 'bank_transfer', ${marker})
      `;
      await database!`
        insert into tasks (id, owner_id, client_id, title, due_date, priority)
        values (${taskId}, ${ownerId}, ${clientId!}, ${`Tarea ${marker}`}, ${today}, 'high')
      `;
      await database!`
        insert into expense_categories (id, owner_id, name)
        values (${expenseCategoryId}, ${ownerId}, ${`Dashboard E2E ${marker}`})
      `;
      await database!`
        insert into expenses (
          id, owner_id, category_id, title, amount_minor, currency,
          scope, cost_type, due_date, status
        ) values (
          ${expenseId}, ${ownerId}, ${expenseCategoryId}, ${expenseTitle}, 1234,
          'USD', 'business', 'fixed', ${today}, 'pending'
        )
      `;

      await page.goto("/dashboard");
      await expect(page.getByRole("heading", { name: "Resumen diario" })).toBeVisible();
      await expect(page.getByText(clientName).first()).toBeVisible();
      await expect(page.getByText(`Cobro ${marker}`).first()).toBeVisible();
      await expect(page.getByText(`Tarea ${marker}`).first()).toBeVisible();
      await expect(page.getByText(expenseTitle).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Gastos del mes" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Balance proyectado" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Ingresos vs gastos — este mes" })).toBeVisible();
      await expect(page.getByText("USD 456,78").first()).toBeVisible();
      await expect(page.getByText("USD 321,23").first()).toBeVisible();
    } finally {
      if (database) {
        await database`delete from expenses where id = ${expenseId}`;
        await database`delete from expense_categories where id = ${expenseCategoryId}`;
        await database`delete from tasks where id = ${taskId}`;
        await database`delete from payments where id = ${paymentId}`;
        await database`delete from charges where id = ${chargeId}`;
        const fixtureClients = clientId
          ? [{ id: clientId }]
          : await database`select id from clients where first_name = ${clientName} and company = ${marker} and email = ${clientEmail}`;
        for (const client of fixtureClients) {
          await database`delete from clients where id = ${client.id} and first_name = ${clientName} and company = ${marker} and email = ${clientEmail}`;
        }
      }
    }
  });
});
