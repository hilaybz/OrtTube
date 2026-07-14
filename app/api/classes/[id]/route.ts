import { NextResponse, type NextRequest } from "next/server";
import { updateClass, deleteClass } from "@/lib/classes";
import { isSupportedLanguage } from "@/lib/lang";
import { err, handleError, requireAuth } from "../http";

/**
 * /api/classes/[id]  (class CRUD)
 *   PATCH  → update { name?, language? }.
 *   DELETE → delete the class (cascades members/invites/assignments).
 */

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  let body: { name?: unknown; language?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err("invalid_request", "Body must be JSON", 400);
  }

  const patch: { name?: string; language?: "he" | "ar" | "en" } = {};
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return err("invalid_request", "name must be a non-empty string", 400);
    }
    patch.name = body.name.trim();
  }
  if (body.language !== undefined) {
    if (!isSupportedLanguage(body.language)) {
      return err("invalid_request", "language must be one of he, ar, en", 400);
    }
    patch.language = body.language;
  }
  if (patch.name === undefined && patch.language === undefined) {
    return err("invalid_request", "Nothing to update", 400);
  }

  try {
    const updated = await updateClass(auth.client, id, patch);
    return NextResponse.json({ class: updated });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  try {
    await deleteClass(auth.client, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleError(e);
  }
}
