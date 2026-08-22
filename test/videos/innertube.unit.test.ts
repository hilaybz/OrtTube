/**
 * The InnerTube player call — no network.
 *
 * This one request now answers everything we know about a video: whether
 * YouTube will play it, which caption tracks exist, and how long it is. It
 * replaced a watch-page scrape that cost ~1,197 KB for the same 10.4 KB of
 * fields and was served by only 3 of 5 residential exits.
 *
 * Because it is the sole source, the failure mapping matters as much as the
 * happy path: a bot wall must never be reported in a way that lets a caller
 * conclude "this video has no captions".
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchPlayerResponse } from "@/lib/innertube";

/** Stub `fetch` — with no proxy configured, `proxiedFetch` delegates to it. */
function youtubeServes(body: string, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPlayerResponse", () => {
  it("reads playability, tracks and duration from one response", async () => {
    youtubeServes(
      JSON.stringify({
        playabilityStatus: { status: "OK" },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{ baseUrl: "u", languageCode: "iw", kind: "asr" }],
          },
        },
        videoDetails: { lengthSeconds: "314" },
      })
    );

    const result = await fetchPlayerResponse("vid");

    expect(result).toEqual({
      ok: true,
      playability: "OK",
      tracks: [{ baseUrl: "u", languageCode: "iw", kind: "asr" }],
      lengthSeconds: 314,
    });
  });

  it("sends the same client fingerprint the download uses", async () => {
    // Our metadata call and the package's download go out back-to-back through
    // the same exit; looking like two different clients invites being treated
    // as one. Verified live: this exact context returns all three fields.
    youtubeServes(JSON.stringify({ playabilityStatus: { status: "OK" } }));

    await fetchPlayerResponse("vid");

    const [url, init] = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe("https://www.youtube.com/youtubei/v1/player?prettyPrint=false");
    expect(init.method).toBe("POST");
    expect(init.headers["User-Agent"]).toBe(
      "com.google.android.youtube/20.10.38 (Linux; U; Android 14)"
    );
    expect(JSON.parse(init.body)).toEqual({
      context: { client: { clientName: "ANDROID", clientVersion: "20.10.38" } },
      videoId: "vid",
    });
  });

  it("reports an empty track list when the captions key is absent", async () => {
    // Verified against a live response: a video with no captions omits the
    // `captions` object entirely rather than sending an empty one.
    youtubeServes(JSON.stringify({ playabilityStatus: { status: "OK" } }));

    const result = await fetchPlayerResponse("vid");

    expect(result).toMatchObject({ ok: true, playability: "OK", tracks: [] });
  });

  it("keeps playability even when it is not OK", async () => {
    // The bot-check shape. Losing this field is what once let a blocked fetch
    // be recorded as a confirmed "no captions".
    youtubeServes(JSON.stringify({ playabilityStatus: { status: "LOGIN_REQUIRED" } }));

    const result = await fetchPlayerResponse("vid");

    expect(result).toMatchObject({ ok: true, playability: "LOGIN_REQUIRED", tracks: [] });
  });

  it("maps a refusal to http_<status>, not to a verdict", async () => {
    youtubeServes("Too Many Requests", 429);
    expect(await fetchPlayerResponse("vid")).toEqual({ ok: false, failure: "http_429" });
  });

  it("maps a bot wall answering 200 with HTML to no_player_json", async () => {
    // Google's "automated queries" interstitial is a 200 that is not JSON.
    youtubeServes("<html><body>Sorry...</body></html>");
    expect(await fetchPlayerResponse("vid")).toEqual({ ok: false, failure: "no_player_json" });
  });

  it("rejects JSON that is not a player response", async () => {
    // Valid JSON without playabilityStatus means we were not talking to the
    // player API — treating it as an answer would invent a null playability.
    youtubeServes(JSON.stringify({ videoDetails: { lengthSeconds: "10" } }));
    expect(await fetchPlayerResponse("vid")).toEqual({ ok: false, failure: "no_player_json" });
  });

  it("names the cause of a transport failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new TypeError("fetch failed"), {
          cause: Object.assign(new Error("connect"), { code: "ECONNREFUSED" }),
        });
      })
    );

    const result = await fetchPlayerResponse("vid");

    // The bare wrapper message is useless on its own; undici puts the real
    // diagnosis on `.cause`.
    expect(result).toEqual({
      ok: false,
      failure: "TypeError: fetch failed (ECONNREFUSED)",
    });
  });

  it("treats a missing or nonsensical duration as null, not zero", async () => {
    // Callers store this straight onto the video row; a 0 would render as a
    // real zero-length video rather than "unknown".
    youtubeServes(
      JSON.stringify({ playabilityStatus: { status: "OK" }, videoDetails: { lengthSeconds: "0" } })
    );
    expect(await fetchPlayerResponse("vid")).toMatchObject({ lengthSeconds: null });

    youtubeServes(JSON.stringify({ playabilityStatus: { status: "OK" }, videoDetails: {} }));
    expect(await fetchPlayerResponse("vid")).toMatchObject({ lengthSeconds: null });
  });

  it("appends the request to a trace when one is given", async () => {
    youtubeServes(JSON.stringify({ playabilityStatus: { status: "OK" } }));
    const trace: string[] = [];

    await fetchPlayerResponse("vid", trace);

    expect(trace).toContain("POST www.youtube.com/youtubei/v1/player → 200");
  });
});
