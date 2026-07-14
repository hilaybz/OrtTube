import { NextResponse, type NextRequest } from "next/server";
import { revokeInvite } from "@/lib/classes";
import { err, handleError, requireAuth } from "../../http";

/**
 * DELETE /api/classes/[id]/invites?email=...  (revoke a pending invite).
 * Idempotent. Email is a query param so the DELETE carries no body.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  const email = req.nextUrl.searchParams.get("email")?.trim() ?? "";
  if (!email) return err("invalid_email", "email query param is required", 400);

  try {
    await revokeInvite(auth.client, id, email);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
