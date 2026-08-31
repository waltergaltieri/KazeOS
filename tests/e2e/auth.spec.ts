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

test("auth endpoints return no-store headers and safe login errors", async ({
  page,
  request,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("missing-user@example.com");
  await page.getByLabel("Contraseña", { exact: true }).fill("valid-password");

  const loginResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/auth/login") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  const loginResponse = await loginResponsePromise;

  expect(loginResponse.status()).toBe(401);
  expect(loginResponse.headers()["cache-control"]).toContain("no-store");
  expect(loginResponse.headers().pragma).toBe("no-cache");
  expect(loginResponse.headers().expires).toBe("0");
  await expect(page.locator(".form-error")).toHaveText(
    "No pudimos iniciar sesión. Verificá tus datos e intentá de nuevo.",
  );

  const logoutResponse = await request.post("/auth/logout", {
    maxRedirects: 0,
  });
  expect(logoutResponse.status()).toBe(303);
  expect(logoutResponse.headers()["cache-control"]).toContain("no-store");
  expect(logoutResponse.headers().pragma).toBe("no-cache");
  expect(logoutResponse.headers().expires).toBe("0");
  expect(new URL(logoutResponse.headers().location).pathname).toBe("/login");
});
