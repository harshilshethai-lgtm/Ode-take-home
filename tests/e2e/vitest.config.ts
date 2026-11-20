import { defineConfig } from "vitest/config";
import root from "../../vite.config";

/** Playwright specs. Kept out of `npm test` so unit tests stay fast. */
export default defineConfig({
  plugins: root.plugins,
  resolve: root.resolve,
  test: {
    environment: "node",
    include: ["tests/e2e/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 300_000,
    hookTimeout: 120_000,
  },
});
