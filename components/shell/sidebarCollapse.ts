/**
 * The sidebar's collapsed/expanded state, kept in a cookie so it survives both
 * client navigations and a full reload — and so the server can render the
 * correct width on the very first paint instead of flashing an expanded rail.
 *
 * Exposed as a tiny external store rather than React state because the value is
 * read during render by a client component that is also server-rendered:
 * `useSyncExternalStore` is the one hook that can serve a server snapshot for
 * hydration and then reconcile with the browser's real value, without setting
 * state from inside an effect (which this repo's lint rules reject).
 *
 * A cookie (not `localStorage`) precisely because the server needs it: layouts
 * read it with `next/headers` and pass it as the server snapshot.
 */

/** Cookie name; `"1"` means collapsed, anything else (or absent) expanded. */
export const SIDEBAR_COLLAPSED_COOKIE = "ot_sidebar_collapsed";

/** A year — this is a durable UI preference, not session state. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const listeners = new Set<() => void>();

function readCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((pair) => pair === `${SIDEBAR_COLLAPSED_COOKIE}=1`);
}

/** `useSyncExternalStore` subscribe: fires on every local toggle. */
export function subscribeSidebarCollapsed(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** `useSyncExternalStore` getSnapshot — a primitive, so no caching needed. */
export function getSidebarCollapsed(): boolean {
  return readCookie();
}

/** Persist a new value and notify every mounted shell. */
export function setSidebarCollapsed(collapsed: boolean): void {
  if (typeof document === "undefined") return;
  document.cookie = `${SIDEBAR_COLLAPSED_COOKIE}=${
    collapsed ? "1" : "0"
  }; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
  for (const listener of listeners) listener();
}
