import { type NextRequest, NextResponse } from "next/server";
import { getClassStats } from "@/lib/analytics";
import { handleError, requireAuth } from "../../http";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const { classId } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  try {
    const stats = await getClassStats(auth.client, classId);
    return NextResponse.json({ stats });
  } catch (e) {
    return handleError(e);
  }
}
