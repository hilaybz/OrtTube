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
      expect(outcome.reason).toBe("page_not_loaded");
    }
  });

  it("treats an unparseable page as transient", async () => {
    youtubeServes("<html><body>nothing useful here</body></html>");

    const outcome = await fetchFreshTranscript("vid");

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.reason).toBe("page_not_loaded");
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
