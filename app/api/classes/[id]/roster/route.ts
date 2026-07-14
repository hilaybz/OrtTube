import { NextResponse, type NextRequest } from "next/server";
import { listClassRoster } from "@/lib/classes";
import { handleError, requireAuth } from "../../http";

/**
 * GET /api/classes/[id]/roster  — enrolled members + pending invites
 * (owner-only; enforced by the SECURITY DEFINER RPC).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  try {
    const roster = await listClassRoster(auth.client, id);
    return NextResponse.json(roster);
  } catch (e) {
    return handleError(e);
  }
}
