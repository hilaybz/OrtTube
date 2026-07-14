import { NextResponse } from "next/server";
import { listAssignedForStudent } from "@/lib/classes";
import { handleError, requireAuth } from "../http";

/**
 * GET /api/classes/assigned  (the student's class-tabbed feed)
 * Lists only assigned, non-deleted quizzes across the student's classes. A
 * deactivated teacher's assigned quizzes stay visible (plan Appendix C).
 *
 * (Static `assigned` segment takes precedence over the sibling `[id]` dynamic
 * segment in the App Router, so it is unambiguous.)
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  try {
    const classes = await listAssignedForStudent(auth.client);
    return NextResponse.json({ classes });
  } catch (e) {
    return handleError(e);
  }
}
