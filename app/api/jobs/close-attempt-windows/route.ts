// POST /api/jobs/close-attempt-windows
//
// Hard-cutoff sweep backstop (Epic 2A.2). Force-completes attempts nobody ever
// came back to interact with after their allocation's `available_until`
// passed — the two interactive paths (`submit_answer`, `complete_attempt`)
// already finalize anyone actually present, so this exists purely so
// analytics don't understate completion for abandoned attempts. All scoring
// logic lives in the SECURITY DEFINER `close_expired_attempt_windows` RPC
// (idempotent via `_finalize_attempt_scores`'s own guard, so an overlapping
// run is harmless).
//
// Guarded by CRON_SECRET (Authorization: Bearer …). Runs daily — Vercel's
// Hobby plan rejects any cron faster than once/day (confirmed: an hourly
// schedule here failed deployment outright), and a day's lag costs nothing
// since this job is a backstop, not the primary mechanism. Tighten the
// cadence in vercel.json if the project ever moves to a paid tier.
//
// Batch limit, highest priority first: JSON body `batchLimit` → `?batchLimit=`
// → default 500. Clamped to >= 1.
import { assertSecret } from "@/lib/jobs/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { callRpc, jobError, jobOk, pickInt, readBody } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const denied = assertSecret(req, "cron");
  if (denied) return denied;

  const body = await readBody(req);
  const url = new URL(req.url);
  const batchLimit = pickInt(
    [body.batchLimit, url.searchParams.get("batchLimit")],
    500,
    1
  );

  const service = createServiceClient();
  const { data, error } = await callRpc<{ closed: number }>(
    service,
    "close_expired_attempt_windows",
    { p_batch_limit: batchLimit }
  );

  if (error) return jobError("close_failed", error.message, 500);
  return jobOk({ closed: data?.closed ?? 0, batchLimit });
}

// Vercel Cron invokes scheduled paths with GET, so the schedule would 405 against
// a POST-only handler and the job would silently never run. POST is kept for
// manual invocation. Vercel attaches `Authorization: Bearer $CRON_SECRET` itself,
// which is what assertSecret(req, "cron") already checks.
export const GET = POST;
