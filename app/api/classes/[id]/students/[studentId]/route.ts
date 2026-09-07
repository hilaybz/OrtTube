import { NextResponse, type NextRequest } from "next/server";
import { removeStudentFromClass } from "@/lib/classes";
import { handleError, requireAuth } from "../../../http";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; studentId: string }> }
) {
  const { id, studentId } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  try {
    await removeStudentFromClass(auth.client, id, studentId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
