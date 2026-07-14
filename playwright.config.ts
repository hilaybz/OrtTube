import { defineConfig, devices } from "@playwright/test";

// Behavioral + a11y self-verify harness. Drives the real dev server; asserts
// against DOM / network / console rather than screenshots.
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: false,
  use: { baseURL: "http://localhost:3000", locale: "he-IL" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
