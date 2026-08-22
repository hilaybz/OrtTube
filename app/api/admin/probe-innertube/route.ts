/**
 * GET /api/admin/probe-innertube?v=<youtubeVideoId>  — DIAGNOSTIC, not product.
 *
 * Answers one question: does any InnerTube client context get real caption data
 * from this deployment's egress IP?
 *
 * YouTube serves a datacenter IP a 200 whose `playabilityStatus` is
 * LOGIN_REQUIRED and whose caption track list is empty — indistinguishable from
 * a genuinely caption-less video unless you compare against an IP it trusts. It
 * applies that policy PER CLIENT CONTEXT, and `youtube-transcript` hardcodes
 * ANDROID, so the only way to learn whether another context is treated
 * differently is to ask each one directly, from the blocked IP. That cannot be
 * reproduced locally: from a residential IP every client answers correctly.
 *
 * Probe with a video KNOWN to have captions, or every row reads as a wall when
 * some are telling the truth. A row with tracks > 0 is a caption path that works
 * from here; all-zero rows mean the wall is on the IP regardless of context, and
 * only a different egress can fix it.
 *
 * Guarded by ADMIN_SECRET: it makes outbound requests on demand, and an open
 * endpoint that does that is an abuse vector.
 *
 * DELIBERATELY UNPROXIED. It uses the global `fetch`, so it still measures the
 * deployment's own egress IP — which is the question it exists to answer. Since
 * `lib/egress.ts` landed, that is NO LONGER the path production takes for
 * captions: a run where every context reads `blocked` is now the EXPECTED result
 * and says nothing about whether transcripts work. It answers "is our raw IP
 * still walled", not "is the product healthy". For the latter, read the `trace`
 * on a real fetch, which names what each proxy exit did.
 */
import { assertSecret } from "@/lib/jobs/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INNERTUBE_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";

/**
 * One client context to impersonate. `context` carries the client-specific
 * fields beyond name/version — the embedded players are rejected without a
 * `thirdParty.embedUrl`, and the Android variants without device details — so a
 * bare name/version would fail for reasons unrelated to the bot wall and read as
 * a false negative.
 */
interface Client {
  label: string;
  userAgent: string;
  client: Record<string, unknown>;
  thirdParty?: Record<string, unknown>;
  /**
   * Whether this context returns caption tracks from a TRUSTED (residential) IP,
   * measured against a captioned video before deploying.
   *
   * Without it the results are unreadable: most of these contexts now answer with
   * no tracks everywhere — YouTube requires proof-of-origin tokens on the browser
   * clients, and the TV/VR client versions here may already be stale — so a zero
   * row proves nothing on its own. Only a context that WORKS from a trusted IP and
   * fails here has been blocked, and that is the only comparison worth reading.
   */
  worksFromTrustedIp: boolean;
}

const CLIENTS: Client[] = [
  {
    label: "ANDROID (current)",
    worksFromTrustedIp: true,
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
    client: {
      clientName: "ANDROID",
      clientVersion: "20.10.38",
      androidSdkVersion: 34,
      osName: "Android",
      osVersion: "14",
    },
  },
  {
    label: "ANDROID_VR",
    worksFromTrustedIp: false,
    userAgent:
      "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12; GB) gzip",
    client: {
      clientName: "ANDROID_VR",
      clientVersion: "1.62.27",
      deviceMake: "Oculus",
      deviceModel: "Quest 3",
      androidSdkVersion: 32,
      osName: "Android",
      osVersion: "12",
    },
  },
  {
    label: "IOS",
    worksFromTrustedIp: true,
    userAgent:
      "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_0 like Mac OS X)",
    client: {
      clientName: "IOS",
      clientVersion: "20.10.4",
      deviceMake: "Apple",
      deviceModel: "iPhone16,2",
      osName: "iPhone",
      osVersion: "18.0.0.22A3354",
    },
  },
  {
    label: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    worksFromTrustedIp: false,
    userAgent:
      "Mozilla/5.0 (PlayStation; PlayStation 4/12.00) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0 Safari/605.1.15",
    client: {
      clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
      clientVersion: "2.0",
      clientScreen: "EMBED",
    },
    thirdParty: { embedUrl: "https://www.youtube.com/" },
  },
  {
    label: "WEB_EMBEDDED_PLAYER",
    worksFromTrustedIp: false,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    client: {
      clientName: "WEB_EMBEDDED_PLAYER",
      clientVersion: "1.20250701.00.00",
      clientScreen: "EMBED",
    },
    thirdParty: { embedUrl: "https://www.youtube.com/" },
  },
  {
    label: "MWEB",
    worksFromTrustedIp: false,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    client: { clientName: "MWEB", clientVersion: "2.20250701.00.00" },
  },
  {
    label: "TVHTML5",
    worksFromTrustedIp: false,
    userAgent:
      "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/25.master.0-qa (unlike Gecko) v8/8.8.278.8-jit gles Starboard/16",
    client: { clientName: "TVHTML5", clientVersion: "7.20250101.00.00" },
  },
  {
    label: "WEB",
    worksFromTrustedIp: false,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    client: { clientName: "WEB", clientVersion: "2.20250701.00.00" },
  },
];

interface ProbeRow {
  client: string;
  /** Mirrors `Client.worksFromTrustedIp` — a zero row only means something here
   * if this is true. */
  informative: boolean;
  httpStatus: number | null;
  playability: string | null;
  /** YouTube's own explanation when it withholds playback ("Sign in to confirm…"). */
  playabilityReason: string | null;
  trackCount: number;
  languages: string[];
  error: string | null;
}

async function probe(client: Client, videoId: string): Promise<ProbeRow> {
  const row: ProbeRow = {
    client: client.label,
    informative: client.worksFromTrustedIp,
    httpStatus: null,
    playability: null,
    playabilityReason: null,
    trackCount: 0,
    languages: [],
    error: null,
  };
  try {
    const res = await fetch(INNERTUBE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": client.userAgent,
      },
      body: JSON.stringify({
        context: {
          client: client.client,
          ...(client.thirdParty ? { thirdParty: client.thirdParty } : {}),
        },
        videoId,
        // Embedded and TV contexts return a stripped response without this.
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    });
    row.httpStatus = res.status;
    if (!res.ok) return row;
    const data = (await res.json()) as {
      playabilityStatus?: { status?: string; reason?: string };
      captions?: {
        playerCaptionsTracklistRenderer?: {
          captionTracks?: { languageCode?: string; kind?: string }[];
        };
      };
    };
    row.playability = data.playabilityStatus?.status ?? null;
    row.playabilityReason = data.playabilityStatus?.reason ?? null;
    const tracks = data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    row.trackCount = tracks.length;
    row.languages = tracks.map(
      (t) => `${t.languageCode ?? "?"}${t.kind === "asr" ? ":asr" : ""}`
    );
  } catch (e) {
    row.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  return row;
}

export async function GET(req: Request): Promise<Response> {
  const denied = assertSecret(req, "admin");
  if (denied) return denied;

  const videoId = new URL(req.url).searchParams.get("v");
  if (!videoId) {
    return Response.json(
      { error: { code: "invalid_request", message: "Pass ?v=<youtubeVideoId>" } },
      { status: 400 }
    );
  }

  // Sequential, not parallel: eight simultaneous requests from one IP is itself
  // the pattern the bot check looks for, and a probe that provokes the wall it is
  // measuring answers the wrong question.
  const results: ProbeRow[] = [];
  for (const client of CLIENTS) {
    results.push(await probe(client, videoId));
  }

  const working = results.filter((r) => r.trackCount > 0).map((r) => r.client);
  // Confined to the contexts that DO return tracks from a trusted IP: the rest
  // answer with none everywhere, so their silence here is not evidence of a block.
  const blocked = results
    .filter((r) => r.informative && r.trackCount === 0)
    .map((r) => r.client);
  return Response.json({
    videoId,
    region: process.env.VERCEL_REGION ?? null,
    // Non-empty → a free fix exists; wire that context in as the caption path.
    working,
    // Every informative context walled → impersonation cannot help from this IP,
    // and only a different egress will.
    blocked,
    results,
  });
}
