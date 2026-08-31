/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const { configDefaults, defineConfig } = require("vitest/config");

module.exports = defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    exclude: [...configDefaults.exclude, "tests/e2e/**"],
    fileParallelism: false,
    globals: true,
    maxWorkers: 1,
    setupFiles: ["./src/test/setup.ts"],
  },
});
