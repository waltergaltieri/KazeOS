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
    headers: { Origin: "http://127.0.0.1:3000" },
    maxRedirects: 0,
  });
  expect(logoutResponse.status()).toBe(303);
  expect(logoutResponse.headers()["cache-control"]).toContain("no-store");
  expect(logoutResponse.headers().pragma).toBe("no-cache");
  expect(logoutResponse.headers().expires).toBe("0");
  expect(new URL(logoutResponse.headers().location).pathname).toBe("/login");
});

test("auth mutations reject foreign and missing origins without cookies", async ({
  request,
}) => {
  for (const endpoint of ["/auth/login", "/auth/logout"]) {
    for (const headers of [
      { Origin: "https://evil.example" },
      undefined,
    ]) {
      const response = await request.post(endpoint, {
        headers,
        maxRedirects: 0,
      });

      expect(response.status()).toBe(403);
      expect(response.headers()["cache-control"]).toContain("no-store");
      expect(response.headers().pragma).toBe("no-cache");
      expect(response.headers().expires).toBe("0");
      expect(response.headers()["set-cookie"]).toBeUndefined();
    }
  }
});

test("979px is mobile and 980px is desktop with no breakpoint overlap", async ({
  page,
}) => {
  await page.setViewportSize({ width: 979, height: 800 });
  await page.goto("/login");
  const mobileColumns = await page.locator(".login-page").evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns,
  );
  expect(await page.evaluate(() => matchMedia("(max-width: 979px)").matches)).toBe(true);
  expect(await page.evaluate(() => matchMedia("(min-width: 980px)").matches)).toBe(false);

  await page.setViewportSize({ width: 980, height: 800 });
  const desktopColumns = await page.locator(".login-page").evaluate(
    (element) => getComputedStyle(element).gridTemplateColumns,
  );
  expect(await page.evaluate(() => matchMedia("(max-width: 979px)").matches)).toBe(false);
  expect(await page.evaluate(() => matchMedia("(min-width: 980px)").matches)).toBe(true);
  expect(desktopColumns).not.toBe(mobileColumns);
});
