// Shared helpers for the CRON_SECRET-guarded scheduled-job endpoints
// (app/api/jobs/*). Not a route module — Next.js only treats `route.ts` as an
// endpoint, so this colocated file is ignored by the router.
//
// Each job is a POST Route Handler that: (1) authorizes via `assertSecret(req,
// "cron")` (checks CRON_SECRET), (2) runs privileged maintenance through the
// service-role client / SECURITY DEFINER RPCs, and (3) returns a JSON summary.
// Failures use the shared `{ error: { code, message } }` envelope.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Storage bucket holding one JSON transcript object per youtube_video_id. */
/*   Mirrors `lib/transcriptCache.ts` (default "transcripts"). */
export const TRANSCRIPT_BUCKET = process.env.TRANSCRIPT_BUCKET || "transcripts";

/** JSON success response for a job (HTTP 200). */
export function jobOk(body: Record<string, unknown>): Response {
  return Response.json(body, { status: 200 });
}

/** JSON error envelope `{ error: { code, message } }` with an HTTP status. */
export function jobError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

/** Best-effort JSON body parse; returns `{}` for empty/invalid bodies. */
export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text();
    if (!text) return {};
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Resolve an integer tuning knob from the given candidate sources in priority
 * order (e.g. request body value, then URL query value, then env var), falling
 * back to `defaultValue`. The result is floored and clamped to `min` so an
 * operator can never drive a destructive job with a zero/negative/absurd window
 * by mistake.
 */
export function pickInt(sources: Array<unknown>, defaultValue: number, min: number): number {
  for (const source of sources) {
    if (source === null || source === undefined || source === "") continue;
    const n = typeof source === "number" ? source : Number(source);
    if (Number.isFinite(n)) return Math.max(min, Math.floor(n));
  }
  return Math.max(min, defaultValue);
}

/**
 * Call a Postgres RPC by name against a default-generic client, bypassing the
 * generated `Database["Functions"]` typing. Used by the maintenance jobs to
 * invoke their SECURITY DEFINER functions through a single small, typed wrapper
 * that returns a normalized `{ data, error }` shape.
 */
export async function callRpc<T = unknown>(
  client: SupabaseClient,
  fn: string,
  args?: Record<string, unknown>
): Promise<{ data: T | null; error: { message: string; code?: string } | null }> {
  // `client` is the default-generic SupabaseClient (Database = any), so `.rpc`
  // accepts an arbitrary function name — see the doc comment above.
  const { data, error } = await client.rpc(fn, args ?? {});
  return {
    data: (data as T) ?? null,
    error: error ? { message: error.message, code: (error as { code?: string }).code } : null,
  };
}
