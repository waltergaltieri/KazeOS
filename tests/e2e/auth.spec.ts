import { expect, test } from "@playwright/test";

test("redirects an unauthenticated dashboard visit to the labeled login form", async ({
  page,
}) => {
  await page.goto("/dashboard");

  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Contraseña", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Iniciar sesión" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Mostrar contraseña" }).click();
  await expect(
    page.getByRole("button", { name: "Ocultar contraseña" }),
  ).toBeVisible();
});
