/**
 * Transcript fetch CLASSIFICATION tests — no network, no DB.
 *
 * These cover the bug that made a deployed teacher unable to add a video: a
 * fetch YouTube had blocked was recorded as a CONFIRMED "this video has no
 * captions", which is sticky and applied to every user.
 *
 * The distinction is subtle and invisible from the outside — a bot-checked or
 * login-walled response still returns 200 and still parses into a player
 * response; it simply carries no caption tracks, exactly like a genuinely
 * caption-less video. The only usable discriminator is `playabilityStatus`, so
 * that is what these tests pin.
 *
 * `global.fetch` is stubbed with real captured shapes rather than mocking
 * `fetchPlayerResponse`, so the parsing and the verdict are exercised together.
 *
 * The InnerTube download is mocked at the package boundary. That keeps the two
 * halves separable: `fetch` then carries only the requests THIS module makes, so a
 * test can assert which ones those are, and each case can drive the download to a
 * chosen result instead of relying on it failing against a stub.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { fetchFreshTranscript } from "@/lib/transcript";

const fetchTranscript = vi.hoisted(() => vi.fn());
vi.mock("youtube-transcript", () => ({
  YoutubeTranscript: { fetchTranscript },
}));

/**
 * A player response as the InnerTube endpoint returns it.
 *
 * These fixtures used to be watch-page HTML with the same object embedded in a
 * `<script>` tag. The classification they drive is unchanged — only the
 * transport is, since the ~1,197 KB scrape was replaced by the ~156 KB player
 * call that carries the identical fields.
 */
function playerResponse(player: unknown): string {
  return JSON.stringify(player);
}

/** Stub the next `fetch` with a raw body. */
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

/** The download finds nothing — the default for the classification cases. */
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

    // This is the one case where "the video has no captions" is a real finding.
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
    // Exactly what Supabase Edge Functions received when we probed from there.
    youtubeServes("Too Many Requests", 429);

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      // The status survives into the reason. A refused request argues for paid
      // egress; the unparseable case below does not, and a bare "not_loaded"
      // could not tell them apart.
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

    // Tracks demonstrably exist, so this must never be "no captions".
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
    // The player call is the module's ONLY direct request; the download goes
    // through the package. Notably it is no longer the 1,197 KB watch page —
    // nothing here should ever fetch /watch again.
    expect(requested).toEqual([
      "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    ]);
    expect(requested.some((u) => u.includes("/watch"))).toBe(false);
  });
});

/**
 * A caption-less video is the single most common reason a fetch ends with
 * nothing, and it used to be the most expensive: the player call answered it in
 * one request, then the download ran anyway, re-asked the same endpoint, and fell
 * through to the ~1.2MB watch page on every exit. Twelve requests for a
 * conclusion already in hand after one, against metered bandwidth.
 */
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
    // Zero tracks means "no captions" only from an intact response. Here it means
    // "we were not told" — and the package's own call may leave from a different
    // exit IP and succeed, so it is worth the request.
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
    // Refusing silently would be worse than fetching: the trace is the only
    // record that this path was even attempted.
    expect(outcome.trace).toContain("GET www.youtube.com/watch → refused (watch-page fallback)");
  });
});

/**
 * The trace is the only record of what a fetch actually did. These failures
 * happen on production egress IPs and cannot be reproduced locally, so if the
 * trace loses a request or an error class, that information is gone for good —
 * which is what these pin.
 */
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
    // The package reports a captcha wall, disabled captions and an unavailable
    // video as distinct error classes. That distinction is the sharpest diagnosis
    // available anywhere in this flow, and it used to be swallowed whole.
    youtubeServes(playerResponse({ playabilityStatus: { status: "LOGIN_REQUIRED" } }));
    class YoutubeTranscriptTooManyRequestError extends Error {}
    fetchTranscript.mockRejectedValue(
      new YoutubeTranscriptTooManyRequestError("captcha required")
    );

    const outcome = await fetchFreshTranscript("vid");

    // `lang=any`: the scrape was blocked, so there was no track list to read a
    // language off, and guessing one would only cost a request.
    expect(outcome.trace).toContain(
      "download lang=any → YoutubeTranscriptTooManyRequestError: captcha required"
    );
  });

  it("records every request the download makes, which it otherwise hides", async () => {
    // The download's own requests are most of the upstream surface and the
    // package exposes none of them; only the injected fetch reaches them.
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

    // Query string dropped: it carries the video id and keys, and the endpoint is
    // what identifies the call.
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

    // An empty answer says something about the video; a throw says something
    // about the egress. Both end as "no transcript" and must stay tellable apart.
    expect(outcome.trace).toContain("download lang=any → empty");
  });
});

/**
 * The download used to walk LANG_PREFERENCE blind — five attempts, four of them
 * guaranteed to miss on a single-track video, each able to pull its own ~1.2MB
 * watch page inside the package. That is ~7MB per video, and on metered proxy
 * egress it multiplies the bill roughly fivefold to learn what the scrape had
 * already returned.
 */
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
    // Hebrew outranks English, and both are present — so no request is spent
    // discovering that.
    servesTracks({ languageCode: "en" }, { languageCode: "he" });

    await fetchFreshTranscript("vid");

    expect(fetchTranscript).toHaveBeenCalledWith("vid", expect.objectContaining({ lang: "he" }));
  });

  it("honours the legacy Hebrew code the same as the modern one", async () => {
    // Older videos tag Hebrew "iw"; it must not be passed over for English.
    servesTracks({ languageCode: "en" }, { languageCode: "iw" });

    await fetchFreshTranscript("vid");

    expect(fetchTranscript).toHaveBeenCalledWith("vid", expect.objectContaining({ lang: "iw" }));
  });

  it("asks for no language when the list holds none the app speaks", async () => {
    // Requesting a language the video does not have would fail on purpose.
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
