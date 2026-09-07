import { NextResponse } from "next/server";
import { listStudentFeed } from "@/lib/classes";
import { handleError, requireAuth } from "../http";

/**
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
