/**
 * Deliberately not `router.back()`: browser history sent the same button to
 * different places depending on how the user got there — including back out of
 * the app — and it cannot name where it is about to land, which is the whole
 * point of this affordance.
 *
 * The registry only holds *places*, never a specific row: a destination that
 * needs an id in its href (one class, one quiz) is not a key, and such a page
 * keeps passing its own `href`/`label` to `BackLink`. An unknown, stale or
 * hand-edited key resolves to nothing and the page falls back to its default,
 * so the param can never send a user somewhere unintended.
 */

export interface BackTarget {
  href: string;
  label: string;
}

export const BACK_PARAM = "from";

export const BACK_TARGETS = {
  overview: { href: "/dashboard", label: "סקירה" },
  quizzes: { href: "/dashboard/quizzes", label: "החידונים שלי" },
  classes: { href: "/dashboard/classes", label: "הכיתות שלי" },
  analytics: { href: "/dashboard/analytics", label: "אנליטיקה" },
  feed: { href: "/student", label: "הפיד שלי" },
} as const satisfies Record<string, BackTarget>;

export type BackTargetKey = keyof typeof BACK_TARGETS;

export function withBackTarget(href: string, from: BackTargetKey): string {
  const [beforeHash, hash] = splitOnce(href, "#");
  const separator = beforeHash.includes("?") ? "&" : "?";
  const withParam = `${beforeHash}${separator}${BACK_PARAM}=${from}`;
  return hash === undefined ? withParam : `${withParam}#${hash}`;
}

export function resolveBackTarget(
  from: string | string[] | undefined | null,
  fallback: BackTarget
): BackTarget {
  const key = Array.isArray(from) ? from[0] : from;
  if (key && isBackTargetKey(key)) return BACK_TARGETS[key];
  return fallback;
}

export function isBackTargetKey(key: string): key is BackTargetKey {
  return Object.hasOwn(BACK_TARGETS, key);
}

function splitOnce(value: string, separator: string): [string, string?] {
  const at = value.indexOf(separator);
  return at === -1
    ? [value]
    : [value.slice(0, at), value.slice(at + separator.length)];
}
