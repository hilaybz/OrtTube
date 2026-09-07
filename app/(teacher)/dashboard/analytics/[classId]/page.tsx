import { permanentRedirect } from "next/navigation";

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
