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
 * `fetchCaptionTracks`, so the parsing and the verdict are exercised together.
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

/** A watch page whose inline player response is `player`. */
function watchPage(player: unknown): string {
  return `<!DOCTYPE html><html><body><script>
    var ytInitialPlayerResponse = ${JSON.stringify(player)};
  </script></body></html>`;
}

/** Stub the next `fetch` with an HTML watch page. */
function youtubeServes(html: string, status = 200): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(html, { status }))
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
      watchPage({ playabilityStatus: { status: "OK" }, videoDetails: {} })
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
      watchPage({ playabilityStatus: { status: "LOGIN_REQUIRED" } })
    );

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.reason).toBe("not_playable:LOGIN_REQUIRED");
    }
  });

  it("does NOT confirm 'unavailable' when playabilityStatus is absent", async () => {
    youtubeServes(watchPage({ videoDetails: {} }));

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
      // egress; the unparseable case below does not, and a bare "page_not_loaded"
      // could not tell them apart.
      expect(outcome.reason).toBe("page_not_loaded:http_429");
    }
  });

  it("treats an unparseable page as transient, distinctly from a refusal", async () => {
    youtubeServes("<html><body>nothing useful here</body></html>");

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.reason).toBe("page_not_loaded:no_player_json");
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
      expect(outcome.reason).toBe("page_not_loaded:TypeError: fetch failed");
    }
  });

  it("reports tracks_undownloadable when tracks exist but the download finds none", async () => {
    youtubeServes(
      watchPage({
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
      watchPage({
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
    // The watch page is the module's ONLY direct request; the download goes
    // through the package.
    expect(requested).toEqual(["https://www.youtube.com/watch?v=vid"]);
  });
});

describe("fetchFreshTranscript provenance", () => {
  const SEGMENTS = [{ text: "שלום", offset: 0, duration: 1000, lang: "iw" }];

  it("labels captions ASR when the scraped track for that language is ASR", async () => {
    youtubeServes(
      watchPage({
        playabilityStatus: { status: "OK" },
        captions: {
          playerCaptionsTracklistRenderer: {
            // Legacy "iw" here, normalised "he" on the download — they must still
            // match, or a real Hebrew ASR track gets labelled as unknown.
            captionTracks: [{ baseUrl: "u", languageCode: "iw", kind: "asr" }],
          },
        },
      })
    );
    fetchTranscript.mockResolvedValue(SEGMENTS);

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.language).toBe("he");
      expect(outcome.kind).toBe("asr");
    }
  });

  it("falls back to 'package' provenance when the scrape was blocked", async () => {
    // The download can still succeed while the watch page is degraded, and then
    // there is no track list to corroborate human-vs-machine. That is unknown, not
    // manual — claiming manual would overstate the transcript's quality.
    youtubeServes("Too Many Requests", 429);
    fetchTranscript.mockResolvedValue(SEGMENTS);

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.language).toBe("he");
      expect(outcome.kind).toBe("package");
    }
  });
});

/**
 * The trace is the only record of what a fetch actually did. These failures
 * happen on production egress IPs and cannot be reproduced locally, so if the
 * trace loses a request or an error class, that information is gone for good —
 * which is what these pin.
 */
describe("fetchFreshTranscript trace", () => {
  it("records the scrape's status and the track list it found", async () => {
    youtubeServes(
      watchPage({
        playabilityStatus: { status: "OK" },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{ baseUrl: "u", languageCode: "en", kind: "asr" }],
          },
        },
      })
    );

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.trace).toContain("GET www.youtube.com/watch → 200");
    expect(outcome.trace).toContain("scrape → playability=OK tracks=1 [en:asr]");
  });

  it("keeps the download's error CLASS, not just its message", async () => {
    // The package reports a captcha wall, disabled captions and an unavailable
    // video as distinct error classes. That distinction is the sharpest diagnosis
    // available anywhere in this flow, and it used to be swallowed whole.
    youtubeServes(watchPage({ playabilityStatus: { status: "LOGIN_REQUIRED" } }));
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
    youtubeServes(watchPage({ playabilityStatus: { status: "OK" } }));
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
    youtubeServes(watchPage({ playabilityStatus: { status: "OK" } }));
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
      watchPage({
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
});
