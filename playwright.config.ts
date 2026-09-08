import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  timeout: 180_000,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  expect: { timeout: 30_000 },
  use: {
    actionTimeout: 30_000,
    baseURL: "http://127.0.0.1:3000",
    navigationTimeout: 30_000,
    trace: "on-first-retry",
  },
  webServer: {
    command: "pnpm dev",
    env: { APP_ORIGIN: "http://127.0.0.1:3000" },
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
  },
});
