import { permanentRedirect } from "next/navigation";
import { classQuizAnalyticsHref } from "@/components/teacher/analyticsLinks";

/**
 * Legacy per-(class, quiz) analytics URL.
 * now the quiz view narrowed to a class, so this segment exists only to keep old
 * links working, including any a teacher bookmarked. It redirects permanently
 * rather than rendering, so nothing has to be maintained twice — the same shape
 * as the legacy `analytics/[classId]` segment.
 */
export default async function LegacyClassQuizAnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; quizId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { id: classId, quizId } = await params;
  const { from } = await searchParams;
  const href = classQuizAnalyticsHref(classId, quizId);
  const key = Array.isArray(from) ? from[0] : from;
  permanentRedirect(key ? `${href}&from=${encodeURIComponent(key)}` : href);
}
