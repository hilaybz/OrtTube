import { NextResponse, type NextRequest } from "next/server";
import { createClass, listMyClasses } from "@/lib/classes";
import { isSupportedLanguage } from "@/lib/lang";
import { err, handleError, requireAuth } from "./http";

/**
 * /api/classes  (class CRUD)
 *   GET  → the signed-in teacher's own classes.
 *   POST → create a class { name, language? }.
 */

export async function GET() {
  const auth = await requireAuth();
  if (auth.response) return auth.response;
  try {
    const classes = await listMyClasses(auth.client);
    return NextResponse.json({ classes });
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  let body: { name?: unknown; language?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return err("invalid_request", "Body must be JSON", 400);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return err("invalid_request", "name is required", 400);
  if (body.language !== undefined && !isSupportedLanguage(body.language)) {
    return err("invalid_request", "language must be one of he, ar, en", 400);
  }

  try {
    const created = await createClass(auth.client, {
      name,
      language: isSupportedLanguage(body.language) ? body.language : undefined,
    });
    return NextResponse.json({ class: created }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}
