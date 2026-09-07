import "server-only";
import { createProxiedFetch } from "./egress";

/**
 * The client fingerprint deliberately matches `youtube-transcript`'s own
 * (ANDROID 20.10.38, its Android-app User-Agent, no hl/gl). Both this call and
 * the package's download go out back-to-back through the same proxy pool, so
 * they should look like one client rather than two.
 */

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
}

export type PlayerResult =
  | {
      ok: true;
      /**
       * `playabilityStatus.status` — "OK", "LOGIN_REQUIRED", "ERROR", … This is
       * the discriminator between a video that genuinely lists no captions and a
       * response that withheld them, and conflating the two is what once let a
       * blocked fetch mark a captioned video as caption-less forever.
       */
      playability: string | null;
      tracks: CaptionTrack[];
      lengthSeconds: number | null;
    }
  /** Never reached, or reached and unparseable. Callers must treat as transient. */
  | { ok: false; failure: string };

const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const CLIENT_VERSION = "20.10.38";
const INNERTUBE_CONTEXT = {
  client: { clientName: "ANDROID", clientVersion: CLIENT_VERSION },
};
const INNERTUBE_USER_AGENT = `com.google.android.youtube/${CLIENT_VERSION} (Linux; U; Android 14)`;

interface RawPlayerResponse {
  playabilityStatus?: { status?: string };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
  videoDetails?: { lengthSeconds?: string };
}

function describe(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = e.cause;
  const suffix =
    cause instanceof Error
      ? ` (${(cause as NodeJS.ErrnoException).code ?? cause.message})`
      : "";
  return `${e.constructor.name}: ${e.message}${suffix}`;
}

export async function fetchPlayerResponse(
  videoId: string,
  trace?: string[],
  signal?: AbortSignal
): Promise<PlayerResult> {
  try {
    const res = await createProxiedFetch(trace)(INNERTUBE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": INNERTUBE_USER_AGENT,
      },
      body: JSON.stringify({ context: INNERTUBE_CONTEXT, videoId }),
      // Shares the caller's whole-fetch budget when there is one, so the player
      // call cannot eat the time the download still needs.
      signal,
    });
    trace?.push(`POST www.youtube.com/youtubei/v1/player → ${res.status}`);
    if (!res.ok) return { ok: false, failure: `http_${res.status}` };

    let data: RawPlayerResponse;
    try {
      data = (await res.json()) as RawPlayerResponse;
    } catch {
      return { ok: false, failure: "no_player_json" };
    }

    if (!data.playabilityStatus) return { ok: false, failure: "no_player_json" };

    const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    // The `captions` key is absent entirely for a video with none — verified
    // against a live response — so this must tolerate every level being missing.
    const found = Array.isArray(tracks) ? tracks : [];

    const rawLength = data.videoDetails?.lengthSeconds;
    const parsed = rawLength ? parseInt(rawLength, 10) : NaN;

    return {
      ok: true,
      playability: data.playabilityStatus.status ?? null,
      tracks: found,
      lengthSeconds: Number.isFinite(parsed) && parsed > 0 ? parsed : null,
    };
  } catch (e) {
    return { ok: false, failure: describe(e) };
  }
}
