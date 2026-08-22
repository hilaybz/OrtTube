/**
 * The editor's confirm gate for the analytics cutoff.
 *
 * The wording lives in `@/lib/analyticsCutoff` (shared with the analytics
 * screens); this module holds only the browser interaction, so the copy can't
 * drift between the warning and the report it warns about.
 *
 * The gate fires only when `analytics_attempt_count > 0`. A quiz nobody has
 * attempted has nothing to lose, and that is when teachers do most of their
 * fiddling — so it stays as frictionless as it is today.
 */

import {
  ANALYTICS_RESET_CONSEQUENCE,
  analyticsAtRiskNotice,
} from "@/lib/analyticsCutoff";

/**
 * Blocking confirm before an edit that would move the cutoff. Returns `true`
 * when there is nothing at risk, so callers can gate unconditionally.
 *
 * `action` names the specific edit ("הזזת נקודת העצירה של השאלה"), because a
 * generic warning on a gesture as small as a marker drag reads as a glitch.
 */
export function confirmContentEdit(count: number, action: string): boolean {
  if (count <= 0) return true;
  return window.confirm(
    `${action}\n\n${analyticsAtRiskNotice(count)}\n\n${ANALYTICS_RESET_CONSEQUENCE}`
  );
}
