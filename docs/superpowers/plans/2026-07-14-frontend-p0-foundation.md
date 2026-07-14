# P0 · Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans (inline) or superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Stand up the typeui Glassmorphism (light) design layer, the shared component primitives, both role shells with route guards, the full auth surface (landing, unified sign-in, student sign-up, sign-out), a seed fixture, and a Playwright self-verify harness — so P1+ build on solid ground.

**Architecture:** Next 16 App Router (RSC for reads via `@/lib`+RLS, client components for mutations via `/api/**`). Design tokens live once in `app/globals.css` as CSS custom properties + `@layer components` glass classes; primitives are thin React components consuming those classes. Two route groups `(teacher)` and `(student)` carry role-guarded layouts. RTL/Hebrew, Rubik font.

**Tech Stack:** Next 16.2, React 19, Tailwind v4, `@supabase/ssr`, Vitest + React Testing Library (jsdom) for component/unit tests, Playwright + `@axe-core/playwright` for behavioral/a11y verification.

**Reference:** design system spec at `.claude/skills/typeui-design-system/SKILL.md` (tokens are binding). All hex/token values below are copied from its `colors.md`/`radius.md`/`shadows.md`/`buttons.md`.

---

## File structure (created/modified in P0)

```
app/
  globals.css                      # MODIFY: replace dark theme → light glass token layer + glass component classes
  layout.tsx                       # MODIFY: Rubik as app font, RTL, metadata
  page.tsx                         # MODIFY: landing (split audience) → redirect if signed in
  (auth)/
    sign-in/page.tsx               # unified sign-in (server) + SignInForm.tsx (client)
    sign-up/page.tsx               # student sign-up (server) + StudentSignUpForm.tsx (client)
  (teacher)/
    layout.tsx                     # role=teacher guard + AppShell(teacher)
    dashboard/page.tsx             # placeholder overview (filled P4)
  (student)/
    layout.tsx                     # role=student guard + AppShell(student)
    student/page.tsx               # placeholder feed (filled P1)
components/
  ui/                              # primitives (one file each)
    GlassCard.tsx Button.tsx Pill.tsx SegmentedToggle.tsx Badge.tsx
    Tabs.tsx Field.tsx Select.tsx Modal.tsx Alert.tsx Tooltip.tsx
    Avatar.tsx Toast.tsx Spinner.tsx Icon.tsx cn.ts
  shell/
    AppShell.tsx Sidebar.tsx Topbar.tsx SignOutButton.tsx
lib/
  profile.ts                       # getMyProfile (RSC read of own profile via RLS)
  errors.ts                        # error-envelope code → Hebrew message map
  http.ts                          # apiFetch helper (client mutations → /api, envelope-aware)
middleware.ts                      # Supabase session refresh + coarse auth gate
test/
  ui/*.test.tsx                    # component behavior/a11y (jsdom + RTL)
  unit/errors.test.ts             # error map unit test
  e2e/p0.spec.ts                   # Playwright: routes render, guard redirects, axe
scripts/seed-fixture.mjs           # provision a playable assignment via HTTP APIs
playwright.config.ts               # Playwright config (webServer: npm run dev)
vitest.config.ts                   # MODIFY: add jsdom for test/ui, keep node for test/**
package.json                       # MODIFY: devDeps + scripts (test:ui, e2e, seed)
```

---

## Task 1: Test + tooling infrastructure

**Files:** Modify `package.json`, `vitest.config.ts`; create `test/ui/setup.ts`, `playwright.config.ts`.

- [ ] **Step 1: Add dev dependencies**

```bash
npm i -D @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom @playwright/test @axe-core/playwright
```

- [ ] **Step 2: Split Vitest into node + jsdom projects**

Replace the single `test` block in `vitest.config.ts` with projects so DB tests stay node-serial and UI tests get jsdom:

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "server-only": resolve(__dirname, "test/stubs/server-only.ts"),
      "@": resolve(__dirname),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          setupFiles: ["./test/setup.ts"],
          include: ["test/**/*.test.ts"],
          exclude: ["test/ui/**"],
          fileParallelism: false,
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
```

- [ ] **Step 3: UI test setup file** — `test/ui/setup.ts`

```ts
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
afterEach(() => cleanup());
```

- [ ] **Step 4: Playwright config** — `playwright.config.ts`

```ts
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./test/e2e",
  testMatch: /.*\.spec\.ts/,
  timeout: 30_000,
  use: { baseURL: "http://localhost:3000", locale: "he-IL" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

- [ ] **Step 5: package.json scripts** — add:

```json
"test:ui": "vitest run --project ui",
"e2e": "playwright test",
"seed": "node scripts/seed-fixture.mjs"
```

- [ ] **Step 6: Install browsers** — `npx playwright install chromium` (network; run manually if sandboxed).
- [ ] **Step 7: Commit** — `git add -A && git commit -m "chore(test): add RTL+jsdom vitest project and Playwright harness"`

---

## Task 2: Design token layer + glass system (`app/globals.css`)

**Files:** Modify `app/globals.css` (replace the current dark theme entirely).

Tokens copied verbatim from `colors.md` (light column), `radius.md`, `shadows.md`, `buttons.md` glint.

- [ ] **Step 1: Replace `app/globals.css`** with:

```css
@import "tailwindcss";

:root {
  /* neutral / surface */
  --neutral-primary-soft:#FFFFFF; --neutral-secondary-soft:#F8FAFB; --neutral-tertiary:#F0F3F5;
  --neutral-quaternary:#E2E7EC; --gray:#CAD1D8;
  /* brand (emerald) */
  --brand-softer:#E6FFF3; --brand-soft:#B8FFD9; --brand:#0EA66D; --brand-strong:#087A4E;
  /* status */
  --success-soft:#ECFDF5; --fg-success:#047857; --danger-soft:#FEF0F2; --fg-danger:#BE123C;
  --warning-soft:#FFF7ED; --fg-warning:#7C2D12;
  /* text */
  --heading:#0F172A; --body:#475569; --body-subtle:#64748B; --white:#FFFFFF;
  --fg-brand:#0EA66D; --fg-brand-strong:#087A4E;
  /* borders */
  --border-default:#E2E7EC; --border-default-medium:#E2E7EC; --border-brand:#0EA66D;
  /* glass (light) */
  --glass-bg:rgba(255,255,255,0.45); --glass-bg-hover:rgba(255,255,255,0.55);
  --glass-border:rgba(0,0,0,0.08); --glass-border-subtle:rgba(0,0,0,0.05);
  --glass-shadow:0 8px 32px rgba(76,29,110,0.08), inset 0 1px 0 rgba(255,255,255,0.8), inset 0 -1px 0 rgba(255,255,255,0.2);
  --glass-edge-top:linear-gradient(90deg,transparent,rgba(255,255,255,0.9),transparent);
  --glass-edge-left:linear-gradient(180deg,rgba(255,255,255,0.9),transparent,rgba(255,255,255,0.4));
  /* glint */
  --color-1-400:rgba(255,255,255,0.30); --color-1-700:rgba(0,0,0,0.08);
  --shadow-xs:0 2px 8px rgba(0,0,0,0.08);
  /* radius */
  --radius:20px; --radius-d:12px; --radius-sm:8px; --radius-full:9999px;
  /* the ambient app gradient */
  --app-gradient:
    radial-gradient(48% 55% at 90% 16%, rgba(216,180,254,0.55), transparent 62%),
    radial-gradient(42% 50% at 96% 92%, rgba(251,207,232,0.5), transparent 60%),
    radial-gradient(62% 80% at 6% 40%, rgba(167,243,208,0.6), transparent 66%),
    radial-gradient(45% 55% at 26% 100%, rgba(187,247,208,0.45), transparent 62%),
    #f4f2fa;
}

* { box-sizing: border-box; }
body {
  min-height:100vh; color:var(--heading);
  background:var(--app-gradient); background-attachment:fixed;
  font-family: var(--font-body), "Rubik", system-ui, sans-serif;
  -webkit-font-smoothing:antialiased;
}
h1,h2,h3,h4 { font-family: var(--font-body), "Rubik", sans-serif; text-wrap:balance; }

@layer components {
  /* frosted glass surface — requires position:relative on the element */
  .glass {
    position:relative; overflow:hidden; background:var(--glass-bg);
    -webkit-backdrop-filter:blur(20px)!important; backdrop-filter:blur(20px)!important;
    border:1px solid var(--glass-border); box-shadow:var(--glass-shadow);
    border-radius:var(--radius);
  }
  .glass::before { content:""; position:absolute; top:0; left:0; right:0; height:1px; background:var(--glass-edge-top); z-index:1; pointer-events:none; }
  .glass::after  { content:""; position:absolute; top:0; left:0; width:1px; height:100%; background:var(--glass-edge-left); z-index:1; pointer-events:none; }
  /* the layered content sits above the edge pseudo-elements */
  .glass > * { position:relative; z-index:2; }
}

:focus-visible { outline:2px solid var(--brand); outline-offset:2px; border-radius:4px; }
@media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation-duration:.001ms!important; transition-duration:.001ms!important; } }
```

- [ ] **Step 2: Verify build compiles** — `npm run build` (expect success; page content may be stale, that's fine).
- [ ] **Step 3: Commit** — `git commit -am "feat(ui): typeui Glassmorphism light token layer + glass system"`

---

## Task 3: Root layout + font + `cn` util

**Files:** Modify `app/layout.tsx`; create `components/ui/cn.ts`.

- [ ] **Step 1:** `components/ui/cn.ts`

```ts
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
```

- [ ] **Step 2:** Replace `app/layout.tsx`:

```tsx
import type { Metadata } from "next";
import { Rubik } from "next/font/google";
import "./globals.css";

const rubik = Rubik({ subsets: ["hebrew", "latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "OrtTube — לומדים חכם יותר",
  description: "צופים בסרטון, עונים על שאלות ושואלים את ה-AI — פלטפורמת למידה לבתי ספר",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={rubik.variable}>
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 3: Commit** — `git commit -am "feat(ui): Rubik app font + cn helper"`

---

## Task 4: `lib/profile.ts` + `lib/errors.ts` + `lib/http.ts`

**Files:** Create `lib/profile.ts`, `lib/errors.ts`, `lib/http.ts`, `test/unit/errors.test.ts`.

- [ ] **Step 1: Failing test** — `test/unit/errors.test.ts` (note: node project glob is `test/**/*.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { messageForCode } from "@/lib/errors";

describe("messageForCode", () => {
  it("maps known codes to Hebrew", () => {
    expect(messageForCode("no_attempts_left")).toContain("ניסיונות");
    expect(messageForCode("invalid_credentials")).toContain("שגוי");
  });
  it("falls back for unknown codes", () => {
    expect(messageForCode("weird_code")).toBe("אירעה שגיאה. נסו שוב.");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/unit/errors.test.ts` → FAIL (module missing).
- [ ] **Step 3:** `lib/errors.ts`

```ts
const MESSAGES: Record<string, string> = {
  unauthorized: "יש להתחבר כדי להמשיך.",
  invalid_credentials: "אימייל או סיסמה שגויים.",
  not_member: "אינך רשום/ה לכיתה זו.",
  not_assigned: "המבחן אינו מוקצה לכיתה זו.",
  no_attempts_left: "לא נותרו ניסיונות נוספים.",
  already_answered: "כבר ענית על שאלה זו.",
  attempt_completed: "הניסיון כבר הושלם.",
  tutor_off: "המורה־AI כבוי במבחן זה.",
  not_owner: "אין לך הרשאה לפעולה זו.",
  cross_school: "התלמיד/ה שייך/ת לבית ספר אחר.",
  invalid_email: "כתובת אימייל לא תקינה.",
};
export function messageForCode(code: string | undefined): string {
  return (code && MESSAGES[code]) || "אירעה שגיאה. נסו שוב.";
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5:** `lib/http.ts` (client mutation helper; throws `{code,message}` on envelope error)

```ts
import { messageForCode } from "@/lib/errors";
export class ApiError extends Error { constructor(public code: string) { super(messageForCode(code)); } }
export async function apiFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.error?.code ?? "internal_error");
  return body as T;
}
```

- [ ] **Step 6:** `lib/profile.ts` (RSC read of own profile via RLS self-select)

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
export interface MyProfile {
  id: string; role: "teacher" | "student"; school_id: string;
  email: string; preferred_language: "he" | "ar" | "en" | null; deactivated_at: string | null;
}
export async function getMyProfile(client: SupabaseClient): Promise<MyProfile | null> {
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const { data } = await client
    .from("profiles")
    .select("id, role, school_id, email, preferred_language, deactivated_at")
    .eq("id", user.id).maybeSingle();
  return (data as MyProfile) ?? null;
}
```

- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(lib): profile read, error-code Hebrew map, apiFetch helper"`

---

## Task 5: Core primitives — `Button`, `GlassCard`, `Spinner`, `Icon`

**Files:** Create `components/ui/{Button,GlassCard,Spinner,Icon}.tsx`, `test/ui/Button.test.tsx`.

- [ ] **Step 1: Failing test** — `test/ui/Button.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { Button } from "@/components/ui/Button";

describe("Button", () => {
  it("fires onClick and is a real <button>", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>שליחה</Button>);
    await userEvent.click(screen.getByRole("button", { name: "שליחה" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
  it("does not fire when disabled", async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>שליחה</Button>);
    await userEvent.click(screen.getByRole("button", { name: "שליחה" })).catch(() => {});
    expect(onClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** — `npm run test:ui` → FAIL.
- [ ] **Step 3:** `components/ui/Button.tsx` — variants per `buttons.md` (brand/secondary/tertiary/ghost/danger), glint on non-ghost, ink text on brand (contrast). Sizes sm/base/lg.

```tsx
"use client";
import { cn } from "./cn";
type Variant = "brand" | "secondary" | "tertiary" | "ghost" | "danger";
type Size = "sm" | "base" | "lg";
const SIZE: Record<Size, string> = { sm: "text-sm px-3 py-2", base: "text-sm px-4 py-2.5", lg: "text-base px-5 py-3" };
const glint = "shadow-[var(--shadow-xs),inset_var(--color-1-400)_0_6px_0px_-5px,var(--color-1-700)_0_4px_10px_-5px]";
const VARIANT: Record<Variant, string> = {
  brand: `bg-[var(--brand)] text-[#06210f] border border-transparent hover:bg-[var(--brand-strong)] ${glint}`,
  secondary: `bg-[var(--neutral-quaternary)] text-[var(--body)] border border-[var(--border-default-medium)] hover:text-[var(--heading)] ${glint}`,
  tertiary: `bg-[var(--neutral-primary-soft)] text-[var(--body)] border border-[var(--border-default)] hover:bg-[var(--neutral-quaternary)] ${glint}`,
  danger: `bg-[var(--fg-danger)] text-white border border-transparent ${glint}`,
  ghost: "bg-transparent text-[var(--heading)] border border-transparent hover:bg-[var(--neutral-quaternary)]",
};
export function Button({
  variant = "brand", size = "base", className, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[var(--radius)] font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:bg-[var(--neutral-tertiary)] disabled:text-[var(--body-subtle)] disabled:shadow-none",
        SIZE[size], VARIANT[variant], className,
      )}
      {...props}
    />
  );
}
```

- [ ] **Step 4:** `components/ui/GlassCard.tsx`

```tsx
import { cn } from "./cn";
export function GlassCard({
  as: As = "div", interactive, className, children, ...props
}: React.HTMLAttributes<HTMLElement> & { as?: React.ElementType; interactive?: boolean }) {
  return (
    <As className={cn("glass p-5", interactive && "cursor-pointer transition-colors hover:bg-[var(--glass-bg-hover)]", className)} {...props}>
      {children}
    </As>
  );
}
```

- [ ] **Step 5:** `components/ui/Spinner.tsx` (accessible busy indicator) and `components/ui/Icon.tsx` (stroke-icon wrapper — a typed set: play, sparkle, lock, chevron, search, check, close, grid, chart, book, users, class, settings). Provide a `name → path` map, `<svg role="img" aria-label>` when labelled else `aria-hidden`.

```tsx
// Icon.tsx
const PATHS: Record<string, React.ReactNode> = {
  play: <path d="M8 5v14l11-7z" />,
  sparkle: <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />,
  lock: <><rect x="4" y="10" width="16" height="10" rx="1.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  chevron: <path d="M6 9l6 6 6-6" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>,
  check: <path d="M20 6L9 17l-5-5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  // nav glyphs (referenced by the teacher/student nav in Task 11)
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  book: <><path d="M4 5h13a3 3 0 0 1 3 3v11H7a3 3 0 0 0-3 3z" /><path d="M4 5v14" /></>,
  class: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /></>,
  chart: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2 21c0-3.5 3-6 7-6s7 2.5 7 6" /><path d="M17 7a3 3 0 0 1 0 6" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 13a7.8 7.8 0 0 0 0-2l2-1.5-2-3.5-2.4 1a7.5 7.5 0 0 0-1.7-1L15 3H9l-.3 2.5a7.5 7.5 0 0 0-1.7 1l-2.4-1-2 3.5 2 1.5a7.8 7.8 0 0 0 0 2l-2 1.5 2 3.5 2.4-1a7.5 7.5 0 0 0 1.7 1L9 21h6l.3-2.5a7.5 7.5 0 0 0 1.7-1l2.4 1 2-3.5z" /></>,
};
export function Icon({ name, label, size = 20, className }: { name: keyof typeof PATHS; label?: string; size?: number; className?: string }) {
  const filled = name === "play" || name === "sparkle";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"} stroke={filled ? "none" : "currentColor"}
      strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round"
      role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={className}>
      {PATHS[name]}
    </svg>
  );
}
```

- [ ] **Step 6: Run** — `npm run test:ui` → PASS.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(ui): Button, GlassCard, Spinner, Icon primitives"`

---

## Task 6: Form + selection primitives — `Field`, `Select`, `Pill`, `SegmentedToggle`, `Badge`

**Files:** Create the five files under `components/ui/`, `test/ui/Field.test.tsx`.

- [ ] **Step 1: Failing test** — `test/ui/Field.test.tsx` asserts label↔input association:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Field } from "@/components/ui/Field";
describe("Field", () => {
  it("associates label with input via id/htmlFor", () => {
    render(<Field label="אימייל" name="email" type="email" />);
    const input = screen.getByLabelText("אימייל");
    expect(input).toHaveAttribute("type", "email");
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3:** `Field.tsx` (label + input per `inputs.md`: glass bg, 1px glass-border, focus → border-brand + ring; `id` from `name`, error state with `aria-invalid` + message).

```tsx
"use client";
import { useId } from "react";
import { cn } from "./cn";
export function Field({ label, name, error, className, ...props }:
  React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; error?: string }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-[var(--heading)]">{label}</label>
      <input id={id} name={name} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined}
        className={cn("rounded-[var(--radius)] bg-[var(--glass-bg)] backdrop-blur-[20px] px-3 py-2.5 text-sm text-[var(--heading)]",
          "border transition-colors placeholder:text-[var(--body)]",
          error ? "border-[var(--fg-danger)] focus:ring-1 focus:ring-[var(--fg-danger)]" : "border-[var(--glass-border)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)]",
          "outline-none", className)}
        {...props} />
      {error && <p id={`${id}-err`} className="text-sm text-[var(--fg-danger)]">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4:** `Pill.tsx` (rounded-full toggle: `active` → brand bg white text + shadow, else glass), `SegmentedToggle.tsx` (group of pills, controlled `value`/`onChange`, `role="tablist"`/`radiogroup`), `Badge.tsx` (variants brand/gray/danger/success + count/dot per `badges.md`), `Select.tsx` (native `<select>` styled as glass input, label association like Field).
- [ ] **Step 5: Run** — `npm run test:ui` → PASS.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(ui): Field, Select, Pill, SegmentedToggle, Badge"`

---

## Task 7: `Tabs` (underline) + `Modal` (focus-trap)

**Files:** Create `components/ui/Tabs.tsx`, `components/ui/Modal.tsx`; `test/ui/Modal.test.tsx`.

- [ ] **Step 1: Failing test** — `test/ui/Modal.test.tsx`: opens with `role="dialog"`, Escape calls onClose, focus moves inside.

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { Modal } from "@/components/ui/Modal";
describe("Modal", () => {
  it("renders as dialog and closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Modal open title="שאל/י את המורה" onClose={onClose}><p>תוכן</p></Modal>);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
  it("renders nothing when closed", () => {
    const { container } = render(<Modal open={false} title="x" onClose={() => {}}>y</Modal>);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3:** `Modal.tsx` per `modals.md`: fixed overlay (black 50% + backdrop-blur 8px), glass content, header (title + ghost close button), Escape + overlay-click close, `role="dialog" aria-modal`, focus first focusable on open, restore focus on close, reduced-motion aware. `Tabs.tsx`: underline variant per `tabs.md`, `role="tablist"`, arrow-key navigation, active → fg-brand + border-brand.
- [ ] **Step 4: Run** — `npm run test:ui` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(ui): Tabs and focus-trapping Modal"`

---

## Task 8: Remaining primitives — `Alert`, `Tooltip`, `Avatar`, `Toast`

**Files:** Create the four files under `components/ui/`; `components/ui/Toast.tsx` includes a `ToastProvider` + `useToast()` hook.

- [ ] **Step 1:** `Alert.tsx` (variants brand/success/danger/warning per `alerts.md`; `role="alert"` for danger/warning).
- [ ] **Step 2:** `Avatar.tsx` (initials fallback, sizes, `alt`), `Tooltip.tsx` (dark variant, `role="tooltip"`, hover/focus).
- [ ] **Step 3:** `Toast.tsx` — context provider rendering a glass toast stack; `useToast().show(message, variant)`; auto-dismiss; `aria-live="polite"`.
- [ ] **Step 4:** Component smoke test `test/ui/Alert.test.tsx` (danger has `role="alert"`), run `npm run test:ui` → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(ui): Alert, Tooltip, Avatar, Toast"`

---

## Task 9: App shell — `Sidebar`, `Topbar`, `AppShell`, `SignOutButton`

**Files:** Create `components/shell/{Sidebar,Topbar,AppShell,SignOutButton}.tsx`.

- [ ] **Step 1:** `SignOutButton.tsx` (client): POSTs to `/auth/sign-out` then `router.push("/sign-in")`. (Route already exists at `app/auth/sign-out/route.ts`.)

```tsx
"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
export function SignOutButton() {
  const router = useRouter();
  return <Button variant="ghost" onClick={async () => { await fetch("/auth/sign-out", { method: "POST" }); router.push("/sign-in"); router.refresh(); }}>יציאה</Button>;
}
```

(If the existing sign-out route is GET-only, add a POST handler in that file — verify during implementation.)

- [ ] **Step 2:** `Sidebar.tsx` per `sidebars.md`: glass panel, logo tile, filter input (visual), nav-item list (active → white glass pill + brand text/icon + `aria-current="page"`), count badges. Props: `items: {href,label,icon,count?}[]`, `activeHref`. Collapses on mobile behind a trigger.
- [ ] **Step 3:** `Topbar.tsx`: glass bar with a search slot, optional filter `SegmentedToggle` slot, and a right slot (SignOutButton / profile).
- [ ] **Step 4:** `AppShell.tsx`: RTL grid — `Sidebar` on the inline-start (right in RTL) + main column (`Topbar` + scrollable `children`). Accepts `nav`, `topbarRight`.
- [ ] **Step 5:** Component test `test/ui/Sidebar.test.tsx`: active item has `aria-current="page"`. Run → PASS.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(shell): Sidebar, Topbar, AppShell, SignOutButton"`

---

## Task 10: Middleware (session refresh + coarse auth gate)

**Files:** Create `middleware.ts`.

- [ ] **Step 1:** `middleware.ts` — refresh the Supabase session on every request (SSR best practice) and redirect unauthenticated users away from `/dashboard`/`/student` to `/sign-in`. Use `@supabase/ssr` `createServerClient` with request/response cookie plumbing; matcher excludes static/`_next`/`api`.

```ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function middleware(req: NextRequest) {
  const res = NextResponse.next({ request: req });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (all) => { all.forEach(({ name, value, options }) => res.cookies.set(name, value, options)); },
    } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  const path = req.nextUrl.pathname;
  const protectedArea = path.startsWith("/dashboard") || path.startsWith("/student");
  if (!user && protectedArea) {
    const url = req.nextUrl.clone(); url.pathname = "/sign-in"; return NextResponse.redirect(url);
  }
  return res;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"] };
```

- [ ] **Step 2:** Verify env var names against `.env.local.example` (adjust if the anon key var differs). `npm run build` succeeds.
- [ ] **Step 3: Commit** — `git commit -am "feat(auth): session-refresh middleware + coarse route gate"`

---

## Task 11: Route groups + role-guarded layouts + placeholders

**Files:** Create `app/(teacher)/layout.tsx`, `app/(teacher)/dashboard/page.tsx`, `app/(student)/layout.tsx`, `app/(student)/student/page.tsx`.

- [ ] **Step 1:** `app/(teacher)/layout.tsx` — RSC: read profile via `getMyProfile(createClient())`; if none → redirect `/sign-in`; if `role !== "teacher"` → redirect `/student`; else render `AppShell` with the teacher nav (סקירה, מאגר המבחנים, כיתות, אנליטיקה, הגדרות).

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMyProfile } from "@/lib/profile";
import { AppShell } from "@/components/shell/AppShell";
const NAV = [
  { href: "/dashboard", label: "סקירה", icon: "grid" as const },
  { href: "/dashboard/quizzes", label: "מאגר המבחנים", icon: "book" as const },
  { href: "/dashboard/classes", label: "כיתות", icon: "class" as const },
  { href: "/dashboard/analytics", label: "אנליטיקה", icon: "chart" as const },
  { href: "/dashboard/settings", label: "הגדרות", icon: "settings" as const },
];
export default async function TeacherLayout({ children }: { children: React.ReactNode }) {
  const profile = await getMyProfile(await createClient());
  if (!profile) redirect("/sign-in");
  if (profile.role !== "teacher") redirect("/student");
  return <AppShell nav={NAV}>{children}</AppShell>;
}
```

- [ ] **Step 2:** `app/(student)/layout.tsx` — mirror with `role !== "student"` → redirect `/dashboard`; student nav (הפיד, הגדרות).
- [ ] **Step 3:** Placeholder pages: `dashboard/page.tsx` (a `GlassCard` "סקירה — בקרוב") and `student/page.tsx` ("הפיד — בקרוב"). These are replaced in P4/P1.
- [ ] **Step 4:** `npm run build` succeeds.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(app): role-guarded teacher/student shells + placeholders"`

---

## Task 12: Auth surface — landing, sign-in, student sign-up

**Files:** Modify `app/page.tsx`; create `app/(auth)/sign-in/page.tsx` + `SignInForm.tsx`, `app/(auth)/sign-up/page.tsx` + `StudentSignUpForm.tsx`.

- [ ] **Step 1:** `app/page.tsx` (RSC): if signed in, `redirect` to the role home; else render the split landing — a glass hero with the teacher value prop + primary "התחברות" (→`/sign-in`) and a secondary student "הצטרפות עם קוד הזמנה" (→`/sign-up`).
- [ ] **Step 2:** `SignInForm.tsx` (client): email+password `Field`s, submit → `apiFetch("/api/auth/sign-in", {method:"POST", body})` → on success `router.push(data.route)`; show `messageForCode` in an `Alert` on failure (incl. 503 retry hint). Student-only signup link at the bottom.
- [ ] **Step 3:** `sign-in/page.tsx` (RSC): centered glass card wrapping `SignInForm`.
- [ ] **Step 4:** `StudentSignUpForm.tsx` (client): email/password/display-name → `apiFetch("/api/auth/sign-up-student", …)`; on success push `/student`; envelope errors via `Alert`. `sign-up/page.tsx` wraps it, with copy that it requires a class invite.
- [ ] **Step 5:** Component test `test/ui/SignInForm.test.tsx` — mock `fetch`, submit, assert `router.push` called with returned route (mock `next/navigation`). Run `npm run test:ui` → PASS.
- [ ] **Step 6:** `npm run build` succeeds.
- [ ] **Step 7: Commit** — `git add -A && git commit -m "feat(auth): split landing, unified sign-in, student sign-up"`

---

## Task 13: Seed fixture script

**Files:** Create `scripts/seed-fixture.mjs`.

- [ ] **Step 1:** Script provisions, via the admin + authoring + assignment HTTP APIs (using `ADMIN_SECRET` from env against the running dev server), a full playable assignment: seed a teacher (`POST /api/admin/seed-teacher`), sign in as that teacher to create a quiz on a **real** short YouTube video with a transcript (`POST /api/quizzes`), author 2–3 questions (`POST /api/quizzes/[id]/questions`), create a class (`POST /api/classes`), add a student by email (`POST /api/classes/[id]/students`) — sign that student up (`POST /api/auth/sign-up-student`) — and assign the quiz with `maxAttempts` + `tutorMode:"hints"` (`POST /api/classes/[id]/quizzes`). Print the resulting `classId`/`quizId` + the student credentials.
- [ ] **Step 2:** Document usage in a top-of-file comment: requires `supabase start` + `npm run dev` + `.env.local`. Run `npm run seed` and confirm it prints a playable `(classId, quizId)` and student login.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "chore(seed): playable-assignment fixture script"`

---

## Task 14: Playwright self-verify for P0

**Files:** Create `test/e2e/p0.spec.ts`.

- [ ] **Step 1:** Spec covers: (a) `/sign-in` renders the form and passes axe with **no serious/critical violations**; (b) landing `/` renders both CTAs; (c) unauthenticated `/dashboard` and `/student` redirect to `/sign-in`; (d) after seeding, signing in as the teacher lands on `/dashboard` and as the student on `/student`.

```ts
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("sign-in renders and is accessible", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: /התחבר/ })).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(v => ["serious", "critical"].includes(v.impact ?? ""));
  expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
});

test("protected routes redirect when signed out", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/student");
  await expect(page).toHaveURL(/\/sign-in/);
});
```

- [ ] **Step 2: Run** — `npm run e2e` (needs dev server + local Supabase; Playwright starts `npm run dev`). Expect PASS. Fix any axe serious/critical violations before proceeding.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "test(e2e): P0 auth + guard + a11y self-verify"`

---

## P0 exit criteria (self-verify loop, then visual checkpoint)

- `npm run build` clean; `npm run lint` clean; `npm test` (node) green; `npm run test:ui` green; `npm run e2e` green (axe: no serious/critical).
- Contrast recorded for brand/heading/body pairings on the glass gradient (fundamentals contract).
- **Visual checkpoint:** user eyeballs `/`, `/sign-in`, and the two empty shells for look-and-feel before P1.
