import { NextResponse } from "next/server";
import { listStudentFeed } from "@/lib/classes";
import { handleError, requireAuth } from "../http";

/**
 * GET /api/classes/assigned  (the student's flat quiz feed)
 * A flat list across all the student's classes — live allocations plus
 * recently-closed ones the student either completed or missed entirely
 * (`status`: not_started/in_progress/completed/missed). A deactivated
 * teacher's assigned quizzes stay visible (plan Appendix C); only
 * soft-deleted quizzes are hidden.
 *
 * (Static `assigned` segment takes precedence over the sibling `[id]` dynamic
 * segment in the App Router, so it is unambiguous.)
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  try {
    const items = await listStudentFeed(auth.client);
    return NextResponse.json({ items });
  } catch (e) {
    return handleError(e);
  }
}
