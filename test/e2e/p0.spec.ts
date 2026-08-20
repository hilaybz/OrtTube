import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// P0 self-verify: the auth surface renders, is accessible, and the proxy gate
// bounces unauthenticated users out of the protected areas. Behavior is asserted
// against the DOM / URL, not screenshots.

test("the root path forwards a signed-out visitor to the sign-in screen", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in/);
  // Accounts are provisioned by the school — no self-signup path is offered.
  await expect(page.getByRole("link", { name: /יצירת חשבון/ })).toHaveCount(0);
});

test("sign-in renders and has no serious/critical a11y violations", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByLabel("אימייל")).toBeVisible();
  // Ensure the design tokens have actually applied before auditing contrast —
  // otherwise axe can audit an unstyled frame during the dev on-demand compile.
  await expect(page.getByRole("button", { name: "התחברות" })).toHaveCSS(
    "background-color",
    "rgb(14, 166, 109)"
  );
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter((v) =>
    ["serious", "critical"].includes(v.impact ?? "")
  );
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});

test("protected routes redirect to sign-in when signed out", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/student");
  await expect(page).toHaveURL(/\/sign-in/);
});
