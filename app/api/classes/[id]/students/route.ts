import { NextResponse, type NextRequest } from "next/server";
import { addStudentToClass } from "@/lib/classes";
import { err, handleError, requireAuth } from "../../http";

/**
 * POST /api/classes/[id]/students  (add student by email)
 * Body: { email }. Returns { status: 'added', student_id } for an existing
 * same-school student, or { status: 'invited', email } for an unknown email.
 * 403 cross_school / is_teacher per the documented codes.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  let body: { email?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err("invalid_request", "Body must be JSON", 400);
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!email) return err("invalid_email", "email is required", 400);

  try {
    const result = await addStudentToClass(auth.client, id, email);
    return NextResponse.json(result, {
      status: result.status === "added" ? 200 : 201,
    });
  } catch (e) {
    return handleError(e);
  }
}
