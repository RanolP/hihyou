import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { conditions: ["@hihyou/source"] },
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
    // The watchdog kills a hung worker by its pid, which in `threads` would take the whole run down with it.
    pool: "forks",
    setupFiles: ["./vitest.watchdog.ts"],
    // Measured on a 10-core laptop: half the cores finish in the same wall time as the default (cores - 1), since the
    // longest files set the pace, and reusing a worker across files skips re-importing the grammars per file (~30%
    // of the suite's CPU time). That is safe while no test file mocks a module or leaves a global stubbed.
    maxWorkers: "50%",
    isolate: false,
  },
});
