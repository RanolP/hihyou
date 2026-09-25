import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["@hihyou/source"] },
  test: { include: ["packages/*/src/**/*.test.{ts,tsx}"] },
});
