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
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchFreshTranscript } from "@/lib/transcript";

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

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("reports tracks_undownloadable when tracks exist but the download fails", async () => {
    // First call returns the watch page; the caption download then fails.
    const html = watchPage({
      playabilityStatus: { status: "OK" },
      captions: {
        playerCaptionsTracklistRenderer: { captionTracks: [A_CAPTION_TRACK] },
      },
    });
    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        return call === 1
          ? new Response(html, { status: 200 })
          : new Response("", { status: 500 });
      })
    );

    const outcome = await fetchFreshTranscript("vid");

    // Tracks demonstrably exist, so this must never be "no captions".
    expect(outcome.status).not.toBe("unavailable");
  });
});
