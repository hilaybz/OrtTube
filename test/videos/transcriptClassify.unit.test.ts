import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { fetchFreshTranscript } from "@/lib/transcript";

const fetchTranscript = vi.hoisted(() => vi.fn());
vi.mock("youtube-transcript", () => ({
  YoutubeTranscript: { fetchTranscript },
}));

function playerResponse(player: unknown): string {
  return JSON.stringify(player);
}

function youtubeServes(body: string, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body, { status }))
  );
}

const A_CAPTION_TRACK = {
  baseUrl: "https://example.test/timedtext",
  languageCode: "en",
};

function downloadYieldsNothing(): void {
  fetchTranscript.mockRejectedValue(new Error("no transcripts available"));
}

beforeEach(() => {
  downloadYieldsNothing();
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchTranscript.mockReset();
});

describe("fetchFreshTranscript classification", () => {
  it("confirms 'unavailable' only for an intact, PLAYABLE page with no tracks", async () => {
    youtubeServes(
      playerResponse({ playabilityStatus: { status: "OK" }, videoDetails: {} })
    );

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.status).toBe("unavailable");
  });

  it("does NOT confirm 'unavailable' when the page was not playable", async () => {
    // The blocked-fetch shape: 200, parses fine, no captions — but YouTube is
    // telling us it wouldn't play the video for us, so we learned nothing about
    // its captions. Treating this as confirmation is what stranded videos.
    youtubeServes(
      playerResponse({ playabilityStatus: { status: "LOGIN_REQUIRED" } })
    );

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.reason).toBe("not_playable:LOGIN_REQUIRED");
    }
  });

  it("does NOT confirm 'unavailable' when playabilityStatus is absent", async () => {
    youtubeServes(playerResponse({ videoDetails: {} }));

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.status).toBe("error");
  });

  it("treats a rate-limited response as transient, never as a verdict", async () => {
    youtubeServes("Too Many Requests", 429);

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.reason).toBe("player_not_loaded:http_429");
    }
  });

  it("treats an unparseable page as transient, distinctly from a refusal", async () => {
    youtubeServes("<html><body>nothing useful here</body></html>");

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.reason).toBe("player_not_loaded:no_player_json");
    }
  });

  it("keeps a network error distinct from an answered request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.reason).toBe("player_not_loaded:TypeError: fetch failed");
    }
  });

  it("reports tracks_undownloadable when tracks exist but the download finds none", async () => {
    youtubeServes(
      playerResponse({
        playabilityStatus: { status: "OK" },
        captions: {
          playerCaptionsTracklistRenderer: { captionTracks: [A_CAPTION_TRACK] },
        },
      })
    );

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.reason).toBe("tracks_undownloadable");
    }
  });
});

describe("fetchFreshTranscript request surface", () => {
  /**
   * Regression pin for a path that was deleted, not fixed. YouTube answers a
   * timedtext URL taken from the watch page with an empty 200 on every IP and in
   * every subtitle format, so the module must never spend a request on one — and
   * because that failure looks exactly like success (200, no error), re-adding the
   * call would go unnoticed without this test.
   */
  it("never requests a caption track's baseUrl", async () => {
    youtubeServes(
      playerResponse({
        playabilityStatus: { status: "OK" },
        captions: {
          playerCaptionsTracklistRenderer: { captionTracks: [A_CAPTION_TRACK] },
        },
      })
    );

    await fetchFreshTranscript("vid");

    const requested = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(
      (args) => String(args[0])
    );
    expect(requested).not.toContain(A_CAPTION_TRACK.baseUrl);
    expect(requested).toEqual([
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    ]);
    expect(requested.some((u) => u.includes("/watch"))).toBe(false);
  });
});

describe("fetchFreshTranscript cost", () => {
  it("does not attempt a download when the player listed no tracks", async () => {
    youtubeServes(
      playerResponse({ playabilityStatus: { status: "OK" }, videoDetails: {} })
    );

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.status).toBe("unavailable");
    expect(fetchTranscript).not.toHaveBeenCalled();
  });

  it("still attempts a download when the player was BLOCKED and listed none", async () => {
    youtubeServes(playerResponse({ playabilityStatus: { status: "LOGIN_REQUIRED" } }));
    fetchTranscript.mockResolvedValue([
      { text: "שלום", offset: 0, duration: 1000, lang: "iw" },
    ]);

    const outcome = await fetchFreshTranscript("vid");

    expect(fetchTranscript).toHaveBeenCalledTimes(1);
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") expect(outcome.language).toBe("he");
  });

  it("refuses the package's watch-page fallback", async () => {
    // `fetchTranscript` falls back to GET /watch whenever its InnerTube call
    // returns nothing — unconditionally, inside the package, on the exact failure
    // path this system exists to survive. The injected fetch is the only place it
    // can be stopped, and it must throw rather than answer: `fetchViaWebPage`
    // ignores the response status and reads `.text()` regardless.
    youtubeServes(
      playerResponse({
        playabilityStatus: { status: "OK" },
        captions: {
          playerCaptionsTracklistRenderer: { captionTracks: [A_CAPTION_TRACK] },
        },
      })
    );
    let refusal: unknown;
    fetchTranscript.mockImplementation(
      async (_id: string, config: { fetch: typeof globalThis.fetch }) => {
        try {
          await config.fetch("https://www.youtube.com/watch?v=vid");
        } catch (e) {
          refusal = e;
        }
        throw new Error("no transcripts available");
      }
    );

    const outcome = await fetchFreshTranscript("vid");

    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).name).toBe("WatchPageRefused");
    expect(outcome.trace).toContain("GET www.youtube.com/watch → refused (watch-page fallback)");
  });
});

describe("fetchFreshTranscript trace", () => {
  it("records the player call's status and the track list it found", async () => {
    youtubeServes(
      playerResponse({
        playabilityStatus: { status: "OK" },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{ baseUrl: "u", languageCode: "en", kind: "asr" }],
          },
        },
      })
    );

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.trace).toContain("POST www.youtube.com/youtubei/v1/player → 200");
    expect(outcome.trace).toContain("lookup → playability=OK tracks=1 [en:asr]");
  });

  it("keeps the download's error CLASS, not just its message", async () => {
    youtubeServes(playerResponse({ playabilityStatus: { status: "LOGIN_REQUIRED" } }));
    class YoutubeTranscriptTooManyRequestError extends Error {}
    fetchTranscript.mockRejectedValue(
      new YoutubeTranscriptTooManyRequestError("captcha required")
    );

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.trace).toContain(
      "download lang=any → YoutubeTranscriptTooManyRequestError: captcha required"
    );
  });

  it("records every request the download makes, which it otherwise hides", async () => {
    youtubeServes(
      playerResponse({
        playabilityStatus: { status: "OK" },
        captions: {
          playerCaptionsTracklistRenderer: { captionTracks: [A_CAPTION_TRACK] },
        },
      })
    );
    fetchTranscript.mockImplementation(
      async (_id: string, config: { fetch: typeof globalThis.fetch }) => {
        await config.fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
          method: "POST",
        });
        throw new Error("no transcripts available");
      }
    );

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.trace).toContain("POST www.youtube.com/youtubei/v1/player → 200");
  });

  it("separates a download that answered empty from one that failed", async () => {
    youtubeServes(
      playerResponse({
        playabilityStatus: { status: "OK" },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{ baseUrl: "u", languageCode: "ja" }],
          },
        },
      })
    );
    fetchTranscript.mockResolvedValue([]);

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.trace).toContain("download lang=any → empty");
  });
});

describe("fetchFreshTranscript download language", () => {
  beforeEach(() => {
    fetchTranscript.mockResolvedValue([{ text: "hi", offset: 0, duration: 1, lang: "he" }]);
  });

  function servesTracks(...langs: { languageCode: string; kind?: string }[]): void {
    youtubeServes(
      playerResponse({
        playabilityStatus: { status: "OK" },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: langs.map((t) => ({ baseUrl: "u", ...t })),
          },
        },
      })
    );
  }

  it("downloads exactly ONCE, not once per candidate language", async () => {
    servesTracks({ languageCode: "en", kind: "asr" });

    await fetchFreshTranscript("vid");

    expect(fetchTranscript).toHaveBeenCalledTimes(1);
  });

  it("asks for the best language the scrape actually listed", async () => {
    servesTracks({ languageCode: "en" }, { languageCode: "he" });

    await fetchFreshTranscript("vid");

    expect(fetchTranscript).toHaveBeenCalledWith("vid", expect.objectContaining({ lang: "he" }));
  });

  it("honours the legacy Hebrew code the same as the modern one", async () => {
    servesTracks({ languageCode: "en" }, { languageCode: "iw" });

    await fetchFreshTranscript("vid");

    expect(fetchTranscript).toHaveBeenCalledWith("vid", expect.objectContaining({ lang: "iw" }));
  });

  it("asks for no language when the list holds none the app speaks", async () => {
    servesTracks({ languageCode: "ja" });

    await fetchFreshTranscript("vid");

    expect(fetchTranscript).toHaveBeenCalledTimes(1);
    const config = fetchTranscript.mock.calls[0][1];
    expect(config.lang).toBeUndefined();
  });

  it("prefers a human track over an auto-generated one at the same rank", async () => {
    // "iw" and "he" normalise to the same language and therefore rank equally, so
    // without an explicit tie-break the winner is whichever YouTube happened to
    // list first — which can hand back machine captions while a human-written
    // track sits beside them. ASR is listed first here deliberately.
    servesTracks({ languageCode: "iw", kind: "asr" }, { languageCode: "he" });

    await fetchFreshTranscript("vid");

    expect(fetchTranscript).toHaveBeenCalledWith("vid", expect.objectContaining({ lang: "he" }));
  });

  it("keeps the higher-ranked language even when it is the ASR one", async () => {
    // The tie-break applies only WITHIN a rank. Hebrew ASR must still beat
    // human-written English, or the preference order stops meaning anything.
    servesTracks({ languageCode: "en" }, { languageCode: "he", kind: "asr" });

    await fetchFreshTranscript("vid");

    expect(fetchTranscript).toHaveBeenCalledWith("vid", expect.objectContaining({ lang: "he" }));
  });
});

/**
 * `TranscriptSegment` declares milliseconds and every consumer assumes them, but
 * `youtube-transcript` has two parsers that disagree: the srv3 branch returns
 * integer milliseconds, and the classic `<text start="0.04">` branch returns
 * SECONDS through `parseFloat`, unconverted. Nothing in the package says which
 * ran. Seconds-as-milliseconds would silently defeat the tutor's spoiler bound —
 * a segment at true 12.5s reads as 12.5ms, so a playhead of 1s admits the whole
 * video — and collapse every generated question onto the first seconds.
 */
describe("fetchFreshTranscript segment units", () => {
  function servesDuration(lengthSeconds: string) {
    youtubeServes(
      playerResponse({
        playabilityStatus: { status: "OK" },
        videoDetails: { lengthSeconds },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{ baseUrl: "u", languageCode: "en" }],
          },
        },
      })
    );
  }

  it("converts seconds to milliseconds using the video's own duration", async () => {
    servesDuration("600");
    // The classic parser's shape: a 10-minute video whose last segment ends at
    // 595 — impossible in milliseconds, where it would end near 600,000.
    fetchTranscript.mockResolvedValue([
      { text: "a", offset: 0.04, duration: 4.68, lang: "en" },
      { text: "b", offset: 590, duration: 5, lang: "en" },
    ]);

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.segments[0]).toEqual({ text: "a", offset: 40, duration: 4680 });
      expect(outcome.segments[1]).toEqual({ text: "b", offset: 590_000, duration: 5000 });
    }
  });

  it("leaves millisecond timings untouched", async () => {
    servesDuration("600");
    fetchTranscript.mockResolvedValue([
      { text: "a", offset: 40, duration: 4680, lang: "en" },
      { text: "b", offset: 590_000, duration: 5000, lang: "en" },
    ]);

    const outcome = await fetchFreshTranscript("vid");

    if (outcome.status === "ok") {
      expect(outcome.segments[0]).toEqual({ text: "a", offset: 40, duration: 4680 });
      expect(outcome.segments[1]).toEqual({ text: "b", offset: 590_000, duration: 5000 });
    }
  });

  it("falls back to the parsers' signature when no duration is known", async () => {
    // `parseInt` cannot produce a fraction, so a fractional value can only have
    // come from the classic (seconds) branch.
    youtubeServes(
      playerResponse({
        playabilityStatus: { status: "OK" },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{ baseUrl: "u", languageCode: "en" }],
          },
        },
      })
    );
    fetchTranscript.mockResolvedValue([
      { text: "a", offset: 0.04, duration: 4.68, lang: "en" },
    ]);

    const outcome = await fetchFreshTranscript("vid");

    if (outcome.status === "ok") {
      expect(outcome.segments[0]).toEqual({ text: "a", offset: 40, duration: 4680 });
    }
  });
});
