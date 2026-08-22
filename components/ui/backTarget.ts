/**
 * Where "back" goes when a page can be reached from more than one place.
 *
 * A page like the quiz editor is opened from the teacher home *and* from
 * "החידונים שלי", so a single static back link is wrong for one of them. The
 * origin therefore travels in the URL as an explicit `?from=<key>`, and the key
 * is resolved here to a named destination:
 *
 * ```tsx
 * // The outgoing link, wherever the user is leaving from:
 * <IconLink href={withBackTarget("/dashboard/quizzes/new", "overview")} … />
 *
 * // The page that was opened, resolving it against its own default:
 * export default async function Page({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
 *   const { from } = await searchParams;
 *   return <BackLink href="/dashboard/quizzes" label="החידונים שלי" from={from} />;
 * }
 * ```
 *
 * A client component reads the same key with `useSearchParams().get(BACK_PARAM)`
 * and passes it the same way; `BackLink` itself stays server-renderable.
 *
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
  /** Names the destination, not the action — "החידונים שלי", not "חזרה". */
  label: string;
}

/** The search param carrying the key. One name, so both halves agree. */
export const BACK_PARAM = "from";

/**
 * Every place a user can arrive from. Labels match how each destination names
 * itself in the nav and in its own heading.
 */
export const BACK_TARGETS = {
  overview: { href: "/dashboard", label: "סקירה" },
  quizzes: { href: "/dashboard/quizzes", label: "החידונים שלי" },
  classes: { href: "/dashboard/classes", label: "הכיתות שלי" },
  analytics: { href: "/dashboard/analytics", label: "אנליטיקה" },
  feed: { href: "/student", label: "הפיד שלי" },
} as const satisfies Record<string, BackTarget>;

export type BackTargetKey = keyof typeof BACK_TARGETS;

/**
 * Appends the origin key to a link's href. Keeps whatever query and hash the
 * href already carries, so it composes with links that are already
 * parameterised (`?scope=class&id=…`).
 */
export function withBackTarget(href: string, from: BackTargetKey): string {
  const [beforeHash, hash] = splitOnce(href, "#");
  const separator = beforeHash.includes("?") ? "&" : "?";
  const withParam = `${beforeHash}${separator}${BACK_PARAM}=${from}`;
  return hash === undefined ? withParam : `${withParam}#${hash}`;
}

/**
 * Resolves a `from` value straight out of `searchParams` (a string, a repeated
 * param's array, or nothing at all) against the destination the page would
 * otherwise use. Anything unrecognised yields the fallback.
 */
export function resolveBackTarget(
  from: string | string[] | undefined | null,
  fallback: BackTarget
): BackTarget {
  // A repeated `?from=a&from=b` arrives as an array; the first one is the link
  // the user actually followed.
  const key = Array.isArray(from) ? from[0] : from;
  if (key && isBackTargetKey(key)) return BACK_TARGETS[key];
  return fallback;
}

/** Narrows a raw param value to a registered key. */
export function isBackTargetKey(key: string): key is BackTargetKey {
  return Object.hasOwn(BACK_TARGETS, key);
}

function splitOnce(value: string, separator: string): [string, string?] {
  const at = value.indexOf(separator);
  return at === -1
    ? [value]
    : [value.slice(0, at), value.slice(at + separator.length)];
}
