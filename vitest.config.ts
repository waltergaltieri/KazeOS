/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    fileParallelism: false,
    globals: true,
    maxWorkers: 1,
    setupFiles: ["./src/test/setup.ts"],
  },
});
