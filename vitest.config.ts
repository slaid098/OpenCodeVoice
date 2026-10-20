import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      $: fileURLToPath(new URL("./tests/__mocks__/$", import.meta.url)),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
      exclude: [
        "tests/**",
        "src/index.ts",
        "src/types.ts",
        "dist/**",
        "vite.config.ts",
        "vitest.config.ts",
        "vite-env.d.ts",
      ],
    },
  },
});
