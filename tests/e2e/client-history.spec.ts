import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });
const authEmail = process.env.E2E_AUTH_EMAIL;
const authPassword = process.env.E2E_AUTH_PASSWORD;
const cleanupDatabase = process.env.DATABASE_URL ? postgres(process.env.DATABASE_URL, { prepare: false, max: 1 }) : undefined;
const ready = Boolean(authEmail && authPassword && cleanupDatabase);
test.afterAll(async () => cleanupDatabase?.end());

test("protects settings from unauthenticated access", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login\?next=%2Fsettings$/);
});

test.describe("authenticated client history", () => {
  test.skip(!ready, "Pendiente externo: requiere E2E_AUTH_EMAIL, E2E_AUTH_PASSWORD y DATABASE_URL para un usuario real y limpieza exacta.");
  test("creates its own client and manages notes through the dossier", async ({ page }) => {
    const marker = randomUUID();
    const clientName = `Historial E2E ${marker}`;
    const clientEmail = `history-e2e-${marker}@example.invalid`;
    const firstNote = `Conversación inicial ${marker}`;
    const editedNote = `Seguimiento confirmado ${marker}`;
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

      await page.getByRole("link", { name: "Notas" }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/notes$`));
      await page.getByRole("textbox", { name: "Nueva nota" }).fill(firstNote);
      await page.getByRole("button", { name: "Agregar nota" }).click();
      await expect(page.getByText(firstNote, { exact: true })).toBeVisible();
      await page.getByRole("button", { name: `Editar ${firstNote}` }).click();
      await page.getByRole("textbox", { name: `Editar nota ${firstNote}` }).fill(editedNote);
      await page.getByRole("button", { name: "Guardar", exact: true }).click();
      await expect(page.getByText(editedNote, { exact: true })).toBeVisible();

      await page.getByRole("link", { name: "Servicios" }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/services$`));
      await page.getByRole("link", { name: "Cobros" }).click();
      await expect(page.getByRole("link", { name: "Nuevo cobro" }).first()).toHaveAttribute("href", `/charges/new?clientId=${clientId}`);
      await page.getByRole("link", { name: "Tareas" }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${clientId}/tasks`));
    } finally {
      if (cleanupDatabase) {
        const fixtures = clientId ? [{ id: clientId }] : await cleanupDatabase`select id from clients where first_name = ${clientName} and company = ${marker} and email = ${clientEmail}`;
        for (const fixture of fixtures) {
          await cleanupDatabase`delete from client_notes where client_id = ${fixture.id}`;
          await cleanupDatabase`delete from clients where id = ${fixture.id} and first_name = ${clientName} and company = ${marker} and email = ${clientEmail}`;
        }
      }
    }
  });
});
