import { type NextRequest, NextResponse } from "next/server";
import {
  searchAnalyticsEntities,
  type AnalyticsScope,
} from "@/lib/analytics";
import { err, handleError, requireAuth } from "../http";

/**
 * Teacher-authed; the RPC's WHERE clause IS the ownership predicate, and it
 * rejects a deactivated (or non-) teacher with `not_owner` → 403. An unknown
 * scope is rejected here before the round trip, with the same `invalid_args`
 * code the RPC would raise.
 */
const SCOPES: AnalyticsScope[] = ["student", "class", "quiz"];

function positiveInt(raw: string | null, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth.response) return auth.response;

  const scope = req.nextUrl.searchParams.get("scope");
  if (!scope || !SCOPES.includes(scope as AnalyticsScope)) {
    return err(
      "invalid_args",
      "scope must be one of student, class or quiz",
      400
    );
  }

  const query = req.nextUrl.searchParams.get("q") ?? "";
  const limit = positiveInt(req.nextUrl.searchParams.get("limit"), 10);
  const offset = positiveInt(req.nextUrl.searchParams.get("offset"), 0);

  try {
    const result = await searchAnalyticsEntities(
      auth.client,
      scope as AnalyticsScope,
      { query, limit, offset }
    );
    return NextResponse.json(result);
  } catch (e) {
    return handleError(e);
  }
}
