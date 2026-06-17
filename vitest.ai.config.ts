import { defineConfig } from "vitest/config";

// Opt-in AI test suite: the live Anthropic integration tests ONLY (they're
// excluded from the default `pnpm test`). Run with `pnpm test:ai` and
// ANTHROPIC_API_KEY set — they skip cleanly without a key. Real API calls, so
// generous timeouts.
export default defineConfig({
  resolve: { conditions: ["ss-source"] },
  test: {
    include: ["apps/server/src/chat/ai-live.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
