// POST /api/jobs/gc-videos
//
// Orphan-video garbage collection. Deletes canonical `videos` rows that have NO
// referencing quiz and are older than a short grace window (videos.created_at).
// The grace window keeps GC from racing the atomic video+first-quiz create, in
// which a video briefly exists before its quiz. Anti-join integrity + the DELETE
// run atomically inside the SECURITY DEFINER `gc_orphan_videos` RPC, which also
// excludes videos still referenced by a tutor_questions row.
//
// After the DB delete, best-effort remove each video's Storage transcript
// object (`<youtube_video_id>.json`) — Supabase Storage has no native expiry.
//
// Guarded by CRON_SECRET. Suggested cadence: hourly.
//
// Window (minutes), highest priority first: JSON body `graceMinutes` →
// `?graceMinutes=` → env `GC_VIDEO_GRACE_MINUTES` → default 60. Clamped to >= 0.
import { assertSecret } from "@/lib/jobs/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { callRpc, jobError, jobOk, pickInt, readBody, TRANSCRIPT_BUCKET } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DeletedVideo {
  id: string;
  youtube_video_id: string;
}

export async function POST(req: Request): Promise<Response> {
  const denied = assertSecret(req, "cron");
  if (denied) return denied;

  const body = await readBody(req);
  const url = new URL(req.url);
  const graceMinutes = pickInt(
    [body.graceMinutes, url.searchParams.get("graceMinutes"), process.env.GC_VIDEO_GRACE_MINUTES],
    60,
    0
  );

  const service = createServiceClient();
  const { data, error } = await callRpc<DeletedVideo[]>(service, "gc_orphan_videos", {
    p_grace_minutes: graceMinutes,
  });

  if (error) return jobError("gc_failed", error.message, 500);

  const rows = data ?? [];

  // Best-effort Storage cleanup: removing a missing object is a no-op, and a
  // Storage hiccup must not fail the (already committed) DB GC.
  let storageDeleted = 0;
  if (rows.length > 0) {
    const paths = rows.map((r) => `${r.youtube_video_id}.json`);
    const { data: removed } = await service.storage.from(TRANSCRIPT_BUCKET).remove(paths);
    if (removed) storageDeleted = removed.length;
  }

  return jobOk({ deleted: rows.length, storageDeleted, graceMinutes });
}
