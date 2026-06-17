import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Workspace libs publish compiled `dist` to Node (so `node dist/index.js`
  // works), but tests run against fresh TypeScript source via this condition.
  resolve: { conditions: ["ss-source"] },
  test: {
    // .tsx tests are the component suite (jsdom per-file via the
    // @vitest-environment pragma; everything else stays on node).
    include: ["packages/**/*.test.{ts,tsx}", "apps/**/*.test.{ts,tsx}", "mcp/**/*.test.ts"],
    // *.ai-live.test.ts hits the real Anthropic API (cost + a key) — it's its
    // own opt-in suite (vitest.ai.config.ts / `pnpm test:ai`), never the default.
    exclude: [...configDefaults.exclude, "**/ai-live.test.ts", "**/mysql.live.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // Integration tests that need Docker (testcontainers) gate themselves on
    // DATABASE_URL / a reachable daemon and skip when unavailable (20-testing-ci.md).
  },
});
