import { permanentRedirect } from "next/navigation";

/**
 * Legacy per-class analytics URL.
 *
 * Analytics used to be class-first: `/dashboard/analytics/<classId>` was a page.
 * It is now one selection in the search-driven hub, so this segment exists only
 * to keep old links working — including ones in screens this section does not
 * own (the overview's class cards) and any a teacher bookmarked. It redirects
 * permanently rather than rendering, so nothing has to be maintained twice.
 */
export default async function LegacyClassAnalyticsPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  permanentRedirect(
    `/dashboard/analytics?scope=class&id=${encodeURIComponent(classId)}`
  );
}
