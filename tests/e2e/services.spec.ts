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

test("protects client services from unauthenticated access", async ({ page }) => {
  const clientId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await page.goto(`/clients/${clientId}/services`);
  await expect(page).toHaveURL(
    new RegExp(`/login\\?next=%2Fclients%2F${clientId}%2Fservices$`),
  );
});

test.describe("authenticated service lifecycle", () => {
  test.skip(
    !hasAuthenticatedFixture,
    "Pendiente externo: requiere E2E_AUTH_EMAIL, E2E_AUTH_PASSWORD y DATABASE_URL para un usuario real y limpieza exacta.",
  );

  test("creates, projects, edits and pauses a recurring service", async ({ page }) => {
    const fixtureMarker = randomUUID();
    const clientName = `Cliente servicios E2E ${fixtureMarker}`;
    const clientEmail = `services-e2e-${fixtureMarker}@example.com`;
    const serviceName = `Mantenimiento E2E ${fixtureMarker}`;
    let createdClientId: string | undefined;
    let createdServiceId: string | undefined;

    try {
      await page.goto("/login?next=%2Fclients");
      await page.getByLabel("Email").fill(authEmail!);
      await page.getByLabel("Contraseña", { exact: true }).fill(authPassword!);
      await page.getByRole("button", { name: "Iniciar sesión" }).click();
      await expect(page).toHaveURL(/\/clients$/);

      await page.getByRole("link", { name: "Nuevo cliente" }).click();
      await page.getByLabel("Nombre de la persona de contacto *").fill(clientName);
      await page.getByLabel("Email").fill(clientEmail);
      await page.getByRole("button", { name: "Guardar cliente" }).click();
      await expect(page).toHaveURL(/\/clients\/[0-9a-f-]+$/);
      createdClientId = new URL(page.url()).pathname.split("/").at(-1);
      const clientId = createdClientId!;

      await page.getByRole("link", { name: "Servicios" }).click();
      await expect(page).toHaveURL(
        new RegExp(`/clients/${clientId}/services$`),
      );
      await page.getByRole("link", { name: "Crear servicio" }).click();
      await page.getByLabel("Nombre del servicio *").fill(serviceName);
      await page.getByLabel(/Monto/).fill("100,00");
      await page.getByRole("button", { name: "Guardar servicio" }).click();
      await expect(page).toHaveURL(
        new RegExp(`/clients/${clientId}/services$`),
      );

      const serviceRows = await cleanupDatabase!`
        select id from services
        where client_id = ${clientId} and name = ${serviceName}
      `;
      expect(serviceRows).toHaveLength(1);
      createdServiceId = serviceRows[0]?.id as string | undefined;
      expect(createdServiceId).toBeTruthy();
      const serviceId = createdServiceId!;

      const generatedRows = await cleanupDatabase!`
        select period_key from charges
        where service_id = ${serviceId}
          and generated_automatically = true
        order by period_key
      `;
      expect(generatedRows).toHaveLength(3);
      expect(new Set(generatedRows.map((row) => row.period_key)).size).toBe(3);

      const serviceCard = page.getByRole("article").filter({ hasText: serviceName });
      await expect(serviceCard).toContainText("Automático");
      await expect(serviceCard).toContainText("Mensual");
      await serviceCard.getByRole("link", { name: "Editar" }).click();
      await page.getByLabel(/Monto/).fill("200,00");
      await page.getByRole("button", { name: "Guardar servicio" }).click();
      await expect(page).toHaveURL(
        new RegExp(`/clients/${clientId}/services$`),
      );
      await expect(
        page.getByRole("article").filter({ hasText: serviceName }),
      ).toContainText("USD 200,00");

      const reconciledRows = await cleanupDatabase!`
        select amount_minor, status from charges
        where service_id = ${serviceId}
          and generated_automatically = true
      `;
      expect(reconciledRows).toHaveLength(3);
      expect(
        reconciledRows.every(
          (row) => Number(row.amount_minor) === 20_000 && row.status === "pending",
        ),
      ).toBe(true);

      const updatedCard = page.getByRole("article").filter({ hasText: serviceName });
      await updatedCard.getByRole("button", { name: `Pausar ${serviceName}` }).click();
      await updatedCard.getByRole("button", { name: "Confirmar pausa" }).click();
      await expect(updatedCard).toContainText("En pausa");

      const pausedRows = await cleanupDatabase!`
        select status from charges where service_id = ${serviceId}
      `;
      expect(pausedRows).toHaveLength(3);
      expect(pausedRows.every((row) => row.status === "pending")).toBe(true);
    } finally {
      const clientRows = createdClientId
        ? [{ id: createdClientId }]
        : await cleanupDatabase!`
            select id from clients
            where first_name = ${clientName} and email = ${clientEmail}
          `;

      for (const row of clientRows) {
        const clientId = row.id as string;
        await cleanupDatabase!`
          delete from charges where client_id = ${clientId}
            and service_id in (
              select id from services
              where client_id = ${clientId} and name = ${serviceName}
            )
        `;
        await cleanupDatabase!`
          delete from services
          where client_id = ${clientId} and name = ${serviceName}
        `;
        await cleanupDatabase!`
          delete from clients
          where id = ${clientId}
            and first_name = ${clientName}
            and email = ${clientEmail}
        `;
      }
    }
  });
});
