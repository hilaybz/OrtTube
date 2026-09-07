// Orphan auth.users reconciliation. Deletes auth.users rows that have NO
// matching public.profiles row and are older than N minutes. Student signup
// creates the auth user first, then inserts the profile; if the process dies
// between those two steps (a serverless timeout/crash) the auth user is stranded
// with no profile. This job is the safety net that reaps those orphans so a
// re-signup with the same email isn't blocked by a half-created account.
//
// Age floor (minutes), highest priority first: JSON body `olderThanMinutes` →
// `?olderThanMinutes=` → env `RECONCILE_AUTH_MINUTES` → default 30. Clamped to
// a >= 5 min minimum so an in-flight signup (auth user created, profile insert
// pending) is never reaped mid-flow.
import { assertSecret } from "@/lib/jobs/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { callRpc, jobError, jobOk, pickInt, readBody } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface OrphanUser {
  id: string;
  created_at: string;
}

export async function POST(req: Request): Promise<Response> {
  const denied = assertSecret(req, "cron");
  if (denied) return denied;

  const body = await readBody(req);
  const url = new URL(req.url);
  const olderThanMinutes = pickInt(
    [body.olderThanMinutes, url.searchParams.get("olderThanMinutes"), process.env.RECONCILE_AUTH_MINUTES],
    30,
    5
  );

  const service = createServiceClient();
  const { data, error } = await callRpc<OrphanUser[]>(service, "list_orphan_auth_users", {
    p_older_than_minutes: olderThanMinutes,
  });

  if (error) return jobError("reconcile_failed", error.message, 500);

  const orphans = data ?? [];
  let deleted = 0;
  const errors: Array<{ id: string; message: string }> = [];

  for (const orphan of orphans) {
    const { error: deleteError } = await service.auth.admin.deleteUser(orphan.id);
    if (deleteError) {
      errors.push({ id: orphan.id, message: deleteError.message });
    } else {
      deleted += 1;
    }
  }

  return jobOk({ deleted, scanned: orphans.length, errors, olderThanMinutes });
}

// Vercel Cron invokes scheduled paths with GET, so the schedule would 405 against
// a POST-only handler and the job would silently never run. POST is kept for
// manual invocation. Vercel attaches `Authorization: Bearer $CRON_SECRET` itself,
// which is what assertSecret(req, "cron") already checks.
export const GET = POST;
