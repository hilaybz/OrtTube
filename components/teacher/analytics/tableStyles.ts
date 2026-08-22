/**
 * The shared cell classes for every analytics table, so the six of them read as
 * one component rather than six near-copies. Values are `tabular-nums` — these
 * ARE columns of numbers that must align vertically, which is the case
 * `tabular-nums` exists for (a large standalone figure is the opposite case; see
 * `MetricTile`).
 */
export const HEAD_CELL =
  "whitespace-nowrap px-4 py-3 text-start text-sm font-medium text-[var(--body)]";

/** A numeric body cell. */
export const CELL =
  "whitespace-nowrap px-4 py-3.5 text-sm tabular-nums text-[var(--body)]";

/** The row's identifying cell (a `th scope="row"`). */
export const ROW_HEAD =
  "px-4 py-3.5 text-start align-top font-medium text-[var(--heading)]";

/** Row separator, applied to every row but the last. */
export const ROW_BORDER = "border-b border-[var(--glass-border-subtle)]";

/** A row the reader can click through to somewhere. */
export const ROW_LINK = "transition-colors hover:bg-[var(--glass-bg-hover)]";
