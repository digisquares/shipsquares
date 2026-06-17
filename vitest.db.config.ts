import { defineConfig } from "vitest/config";

// Opt-in MySQL integration suite: the live MySQL driver + introspection + browse
// tests ONLY (excluded from the default `pnpm test`). Run with `pnpm test:db`
// and SS_DBTEST_MYSQL_URL set (a throwaway MySQL/MariaDB) — they skip cleanly
// without it. Real DB calls, so generous timeouts. (database-studio/06.)
export default defineConfig({
  resolve: { conditions: ["ss-source"] },
  test: {
    include: ["apps/server/src/dbstudio/engines/mysql.live.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
