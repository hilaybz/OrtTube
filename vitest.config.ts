import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Let server-only modules (e.g. lib/supabase/service.ts) import in Node.
      "server-only": resolve(__dirname, "test/stubs/server-only.ts"),
      // Mirror the tsconfig `@/*` path alias.
      "@": resolve(__dirname),
    },
  },
  test: {
    // Integration tests share a single local database; running test files
    // serially avoids one file's reset/seed clobbering another's state.
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          setupFiles: ["./test/setup.ts"],
          include: ["test/**/*.test.ts"],
          exclude: ["test/ui/**"],
          hookTimeout: 30_000,
          testTimeout: 30_000,
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          setupFiles: ["./test/ui/setup.ts"],
          include: ["test/ui/**/*.test.tsx"],
        },
      },
    ],
  },
});
