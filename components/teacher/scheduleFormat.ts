import type { AllocationState } from "@/lib/allocationState";
import { formatDateTime } from "@/lib/datetime";

/**
 * Scheduling-window display helpers, shared by the two places an allocation's
 * state/window get rendered as a row — the editor's `AllocationsSection` and
 * the class page's `AssignedQuizzesSection` — plus the datetime<->ISO
 * conversion the assign/edit forms (`BulkAssignModal`, the allocations list's
 * per-row edit modal) need. One copy of each so the two UIs can't drift.
 */

export const STATE_LABEL: Record<AllocationState, string> = {
  draft: "טיוטה",
  scheduled: "מתוזמן",
  live: "פעיל",
  done: "הסתיים",
};

export const STATE_VARIANT: Record<AllocationState, "warning" | "gray" | "success"> = {
  draft: "warning",
  scheduled: "gray",
  live: "success",
  done: "gray",
};

/**
 * "D.M HH:mm" for a window bound, in Israeli time.
 *
 * Pinned rather than local: this renders on the server (UTC) and again on the
 * client, and the two must agree or React discards the tree with a hydration
 * error. See `lib/datetime.ts`.
 */
export function formatWindowPart(iso: string | null): string {
  if (!iso) return "";
  return formatDateTime(iso);
}

/** ISO timestamp (or null) → datetime-local input value ("" when null/invalid). */
export function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local input value ("" → null) → ISO timestamp for the API. */
export function fromDatetimeLocalValue(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
