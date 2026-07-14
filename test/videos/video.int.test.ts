/**
 * Videos integration tests — ensureVideo (canonical, deduped, never-downgraded
 * `videos` row; spec §3.3).
 *
 * `fetchVideoMetadata` (oEmbed + watch-page scrape) is mocked so no network I/O
 * runs; the upsert/re-select hits the REAL local Supabase `videos` table.
 *
 * Runs at the integration/gate step (which owns DB application). Skipped when the
 * local DB is unreachable so unit suites still pass without Supabase running.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { ensureVideo } from "@/lib/video";
import { fetchVideoMetadata } from "@/lib/youtube";
import { resetDb, getPool, closePool, getServiceClient } from "../helpers/db";

vi.mock("@/lib/youtube", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/youtube")>();
  return { ...actual, fetchVideoMetadata: vi.fn() };
});

const mockMeta = vi.mocked(fetchVideoMetadata);

async function countRows(youtubeId: string): Promise<number> {
  const { rows } = await getPool().query<{ n: string }>(
    "SELECT count(*)::text AS n FROM public.videos WHERE youtube_video_id = $1",
    [youtubeId]
  );
  return parseInt(rows[0].n, 10);
}

async function dbReachable(): Promise<boolean> {
  try {
    await getPool().query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

const online = await dbReachable();

describe.skipIf(!online)("ensureVideo", () => {
  beforeEach(async () => {
    await resetDb();
    mockMeta.mockReset();
  });

  afterAll(async () => {
    await closePool();
  });

  it("creates the canonical row with fetched metadata", async () => {
    mockMeta.mockResolvedValue({ title: "Intro to Algebra", durationSeconds: 615 });

    const row = await ensureVideo(getServiceClient(), "vid00000001");

    expect(row.youtube_video_id).toBe("vid00000001");
    expect(row.title).toBe("Intro to Algebra");
    expect(row.duration_seconds).toBe(615);
    expect(row.transcript_status).toBe("pending");
    expect(await countRows("vid00000001")).toBe(1);
  });

  it("is idempotent: a second call returns the same row without duplicating", async () => {
    mockMeta.mockResolvedValue({ title: "First", durationSeconds: 100 });
    const first = await ensureVideo(getServiceClient(), "dedup0000001");

    // A concurrent/later caller may see different (or missing) metadata.
    mockMeta.mockResolvedValue({ title: "Second", durationSeconds: 999 });
    const second = await ensureVideo(getServiceClient(), "dedup0000001");

    expect(second.id).toBe(first.id);
    expect(await countRows("dedup0000001")).toBe(1);
    // Never downgrade/overwrite the existing shared row.
    expect(second.title).toBe("First");
    expect(second.duration_seconds).toBe(100);
  });

  it("never downgrades an already-ready video's status", async () => {
    await getPool().query(
      `INSERT INTO public.videos (youtube_video_id, title, transcript_status, fetched_at)
       VALUES ($1, $2, 'ready', now())`,
      ["ready0000001", "Existing"]
    );
    mockMeta.mockResolvedValue({ title: "Different", durationSeconds: 42 });

    const row = await ensureVideo(getServiceClient(), "ready0000001");

    expect(row.transcript_status).toBe("ready");
    expect(row.title).toBe("Existing");
    expect(await countRows("ready0000001")).toBe(1);
  });

  it("tolerates null metadata (row still created)", async () => {
    mockMeta.mockResolvedValue({ title: null, durationSeconds: null });

    const row = await ensureVideo(getServiceClient(), "nullmeta0001");

    expect(row.title).toBeNull();
    expect(row.duration_seconds).toBeNull();
    expect(row.transcript_status).toBe("pending");
  });
});
