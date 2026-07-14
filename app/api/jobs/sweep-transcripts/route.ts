// POST /api/jobs/sweep-transcripts — OPTIONAL
//
// Transcript TTL sweep. Deletes Storage transcript objects older than the TTL to
// bound storage. This is a belt-and-braces job: the read path already re-fetches
// on staleness and gc-videos removes objects for deleted videos, but Supabase
// Storage has NO native object-lifecycle/expiry, so nothing else caps the storage
// of an object whose video still exists yet is never read again. Age is read from
// each object's own Storage metadata (updated_at), so it needs no DB coupling.
//
// Guarded by CRON_SECRET. Suggested cadence: weekly.
//
// TTL (days), highest priority first: JSON body `ttlDays` → `?ttlDays=` → env
// `TRANSCRIPT_TTL_DAYS` → default 30. Clamped to >= 1.
import { assertSecret } from "@/lib/jobs/auth";
import { createServiceClient } from "@/lib/supabase/service";
import { jobError, jobOk, pickInt, readBody, TRANSCRIPT_BUCKET } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(req: Request): Promise<Response> {
  const denied = assertSecret(req, "cron");
  if (denied) return denied;

  const body = await readBody(req);
  const url = new URL(req.url);
  const ttlDays = pickInt(
    [body.ttlDays, url.searchParams.get("ttlDays"), process.env.TRANSCRIPT_TTL_DAYS],
    30,
    1
  );
  const cutoffMs = Date.now() - ttlDays * DAY_MS;

  const service = createServiceClient();
  const bucket = service.storage.from(TRANSCRIPT_BUCKET);

  // Page through the bucket, collecting stale object names.
  const stale: string[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data: page, error } = await bucket.list("", {
      limit: PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) return jobError("sweep_failed", error.message, 500);
    if (!page || page.length === 0) break;

    for (const obj of page) {
      const stamp = obj.updated_at ?? obj.created_at;
      if (stamp && new Date(stamp).getTime() < cutoffMs) stale.push(obj.name);
    }

    if (page.length < PAGE_SIZE) break;
  }

  let deleted = 0;
  if (stale.length > 0) {
    const { data: removed, error } = await bucket.remove(stale);
    if (error) return jobError("sweep_failed", error.message, 500);
    deleted = removed?.length ?? 0;
  }

  return jobOk({ deleted, ttlDays });
}
