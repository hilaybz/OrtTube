// POST /api/jobs/purge-content
//
// Content purge. Hard-DELETEs quizzes whose `deleted_at` is older than the
// retention window; the DB cascade removes their questions/options/translations,
// class_quizzes, attempts, answers and tutor_questions. QUIZ GRANULARITY ONLY —
// a lone soft-deleted question is removed solely via its quiz's cascade, never on
// its own. All integrity logic lives in the SECURITY DEFINER
// `purge_soft_deleted_quizzes` RPC.
//
// Guarded by CRON_SECRET (Authorization: Bearer …). Suggested cadence: daily.
//
// Window (days), highest priority first: JSON body `retentionDays` →
// `?retentionDays=` → env `PURGE_RETENTION_DAYS` → default 30. Clamped to >= 0.
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
  const retentionDays = pickInt(
    [body.retentionDays, url.searchParams.get("retentionDays"), process.env.PURGE_RETENTION_DAYS],
    30,
    0
  );

  const service = createServiceClient();
  const { data, error } = await callRpc<{ deleted: number }>(
    service,
    "purge_soft_deleted_quizzes",
    { p_retention_days: retentionDays }
  );

  if (error) return jobError("purge_failed", error.message, 500);
  return jobOk({ deleted: data?.deleted ?? 0, retentionDays });
}
