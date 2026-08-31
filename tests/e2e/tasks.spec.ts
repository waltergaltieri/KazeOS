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

test("protects the task agenda from unauthenticated access", async ({ page }) => {
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/login\?next=%2Ftasks$/);
});

test.describe("authenticated task lifecycle", () => {
  test.skip(!ready, "Pendiente externo: requiere E2E_AUTH_EMAIL, E2E_AUTH_PASSWORD y DATABASE_URL para un usuario real y limpieza exacta.");

  test("creates its own client and manages one recurring task without duplicates", async ({ page }) => {
    const marker = randomUUID();
    const clientName = `Cliente tareas E2E ${marker}`;
    const clientEmail = `tasks-e2e-${marker}@example.invalid`;
    const taskTitle = `Cierre mensual E2E ${marker}`;
    const disposableTitle = `Descartar E2E ${marker}`;
    let clientId: string | undefined;
    let taskId: string | undefined;

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

      await page.goto(`/tasks/new?clientId=${createdClientId}`);
      await expect(page.getByRole("combobox", { name: "Cliente" })).toContainText(clientName);
      await page.getByLabel("Título *").fill(taskTitle);
      await page.getByLabel("Vencimiento").fill("2027-01-31");
      await page.getByLabel("Repetir mensualmente").check();
      await page.getByRole("button", { name: "Crear tarea" }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${createdClientId}/tasks$`));

      const roots = await cleanupDatabase!`select id from tasks where client_id = ${createdClientId} and title = ${taskTitle} and parent_id is null`;
      expect(roots).toHaveLength(1);
      taskId = roots[0]?.id as string;
      const createdTaskId = taskId;

      await page.goto("/tasks");
      await page.getByRole("searchbox", { name: "Buscar tareas" }).fill(taskTitle);
      await page.getByRole("button", { name: "Buscar" }).click();
      await expect(page.getByText(taskTitle, { exact: true })).toBeVisible();
      await page.getByRole("checkbox", { name: `Completar ${taskTitle}` }).click();
      await expect.poll(async () => (await cleanupDatabase!`select status from tasks where id = ${createdTaskId}`)[0]?.status).toBe("completed");
      await expect.poll(async () => (await cleanupDatabase!`select count(*)::int as count from tasks where parent_id = ${createdTaskId}`)[0]?.count).toBe(1);

      const completedRoot = page.getByRole("listitem").filter({
        has: page.getByRole("checkbox", { name: `Reabrir ${taskTitle}` }),
      });
      await completedRoot.getByRole("link", { name: `Editar ${taskTitle}` }).click();
      await page.getByLabel("Descripción").fill(`Verificado ${marker}`);
      await page.getByRole("button", { name: "Guardar cambios" }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${createdClientId}/tasks$`));
      await expect.poll(async () => (await cleanupDatabase!`select description from tasks where id = ${createdTaskId}`)[0]?.description).toBe(`Verificado ${marker}`);

      await page.goto(`/tasks/new?clientId=${createdClientId}`);
      await page.getByLabel("Título *").fill(disposableTitle);
      await page.getByRole("button", { name: "Crear tarea" }).click();
      await page.getByRole("button", { name: `Eliminar ${disposableTitle}` }).click();
      await page.getByRole("button", { name: `Eliminar tarea ${disposableTitle}` }).click();
      await expect.poll(async () => (await cleanupDatabase!`select count(*)::int as count from tasks where client_id = ${createdClientId} and title = ${disposableTitle}`)[0]?.count).toBe(0);
    } finally {
      if (cleanupDatabase) {
        const clients = clientId ? [{ id: clientId }] : await cleanupDatabase`select id from clients where first_name = ${clientName} and company = ${marker} and email = ${clientEmail}`;
        for (const fixture of clients) {
          await cleanupDatabase`delete from tasks where client_id = ${fixture.id} and parent_id is not null`;
          await cleanupDatabase`delete from tasks where client_id = ${fixture.id}`;
          await cleanupDatabase`delete from clients where id = ${fixture.id} and first_name = ${clientName} and company = ${marker} and email = ${clientEmail}`;
        }
      }
    }
  });
});
