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
const hasAuthenticatedFixture = Boolean(
  authEmail && authPassword && cleanupDatabase,
);

test.afterAll(async () => cleanupDatabase?.end());

test("protects the client portfolio from unauthenticated access", async ({ page }) => {
  await page.goto("/clients");
  await expect(page).toHaveURL(/\/login\?next=%2Fclients$/);
  await expect(page.getByRole("heading", { name: "Bienvenido de nuevo" })).toBeVisible();
});

test.describe("authenticated client lifecycle", () => {
  test.skip(
    !hasAuthenticatedFixture,
    "Pendiente externo: requiere E2E_AUTH_EMAIL, E2E_AUTH_PASSWORD y DATABASE_URL para un usuario real y limpieza exacta.",
  );

  test("creates, finds, opens, edits and archives a client", async ({ page }) => {
    const fixtureMarker = randomUUID();
    const uniqueName = `Cliente E2E ${fixtureMarker}`;
    const fixtureEmail = `client-e2e-${fixtureMarker}@example.com`;
    let createdClientId: string | undefined;

    try {
      await page.goto("/login?next=%2Fclients");
      await page.getByLabel("Email").fill(authEmail!);
      await page.getByLabel("Contraseña", { exact: true }).fill(authPassword!);
      await page.getByRole("button", { name: "Iniciar sesión" }).click();
      await expect(page).toHaveURL(/\/clients$/);

      await page.getByRole("link", { name: "Nuevo cliente" }).click();
      await page.getByLabel("Nombre *").fill(uniqueName);
      await page.getByLabel("Empresa").fill("Verificación KazeOS");
      await page.getByLabel("Email").fill(fixtureEmail);
      await page.getByRole("button", { name: "Guardar cliente" }).click();
      await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/);
      createdClientId = new URL(page.url()).pathname.split("/").at(-1);
      await expect(page.getByRole("heading", { name: uniqueName })).toBeVisible();

      await page.goto("/clients");
      await page.getByRole("searchbox", { name: "Buscar clientes" }).fill(uniqueName);
      await page.getByRole("button", { name: "Buscar" }).click();
      await expect
        .poll(() => new URL(page.url()).searchParams.get("q"))
        .toBe(uniqueName);
      const searchResult = page
        .locator(".client-table-wrap")
        .getByRole("link", { name: uniqueName, exact: true });
      await expect(searchResult).toBeVisible();
      await searchResult.click();
      await expect(page).toHaveURL(new RegExp(`/clients/${createdClientId}$`));

      await page.getByRole("link", { name: "Editar" }).click();
      await page.getByLabel("Empresa").fill("Verificación actualizada");
      await page.getByLabel("Email").fill("");
      await page.getByRole("button", { name: "Guardar cliente" }).click();
      await expect(page.getByText("Verificación actualizada")).toBeVisible();
      await expect(page.getByText(fixtureEmail)).not.toBeVisible();

      await page.getByRole("button", { name: "Archivar" }).click();
      await page.getByRole("button", { name: "Confirmar" }).click();
      await expect(page).toHaveURL(/\/clients\?filter=archived$/);
      await expect(
        page.locator(".client-table-wrap").getByRole("link", {
          name: uniqueName,
          exact: true,
        }),
      ).toBeVisible();
    } finally {
      if (createdClientId) {
        await cleanupDatabase!`delete from clients where id = ${createdClientId}`;
      } else {
        await cleanupDatabase!`delete from clients
          where email = ${fixtureEmail} and first_name = ${uniqueName}`;
      }
    }
  });
});
