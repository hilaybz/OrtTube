import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.ts"],
    // Integration tests share a single local database; running test files
    // serially avoids one file's reset/seed clobbering another's state.
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      // Let server-only modules (e.g. lib/supabase/service.ts) import in Node.
      "server-only": resolve(__dirname, "test/stubs/server-only.ts"),
      // Mirror the tsconfig `@/*` path alias.
      "@": resolve(__dirname),
    },
  },
});
