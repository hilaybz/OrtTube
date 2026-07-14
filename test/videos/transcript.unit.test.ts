import { describe, it, expect } from "vitest";
import {
  pickCaptionTrack,
  sliceTranscriptToPlayhead,
  normalizeLang,
  type CaptionTrack,
  type TranscriptSegment,
} from "../../lib/transcript";

describe("pickCaptionTrack", () => {
  it("prefers a manual track over an ASR track in any language", () => {
    const tracks: CaptionTrack[] = [
      { baseUrl: "u-asr-he", languageCode: "he", kind: "asr" },
      { baseUrl: "u-manual-en", languageCode: "en" }, // manual, no kind
    ];
    const picked = pickCaptionTrack(tracks);
    expect(picked?.baseUrl).toBe("u-manual-en");
    expect(picked?.kind).not.toBe("asr");
  });

  it("prefers app languages within the manual group (he before en)", () => {
    const tracks: CaptionTrack[] = [
      { baseUrl: "u-manual-en", languageCode: "en" },
      { baseUrl: "u-manual-he", languageCode: "he" },
    ];
    expect(pickCaptionTrack(tracks)?.baseUrl).toBe("u-manual-he");
  });

  it("falls back to an ASR track when no manual track exists", () => {
    const tracks: CaptionTrack[] = [
      { baseUrl: "u-asr-en", languageCode: "en", kind: "asr" },
      { baseUrl: "u-asr-he", languageCode: "he", kind: "asr" },
    ];
    const picked = pickCaptionTrack(tracks);
    expect(picked?.kind).toBe("asr");
    expect(picked?.baseUrl).toBe("u-asr-he"); // he preferred among ASR
  });

  it("returns null for an empty track list", () => {
    expect(pickCaptionTrack([])).toBeNull();
  });
});

describe("normalizeLang", () => {
  it("maps the legacy iw code to he and strips region", () => {
    expect(normalizeLang("iw")).toBe("he");
    expect(normalizeLang("en-US")).toBe("en");
    expect(normalizeLang("AR")).toBe("ar");
  });
  it("returns null for empty input", () => {
    expect(normalizeLang(null)).toBeNull();
    expect(normalizeLang(undefined)).toBeNull();
  });
});

describe("sliceTranscriptToPlayhead", () => {
  const segments: TranscriptSegment[] = [
    { text: "one", offset: 0, duration: 1000 },
    { text: "two", offset: 5000, duration: 1000 },
    { text: "three", offset: 10000, duration: 1000 },
    { text: "four", offset: 20000, duration: 1000 }, // after the playhead
  ];

  // UPDATED (D2): a segment is included only if it has FULLY ELAPSED
  // (offset+duration <= playhead). A segment that merely started before the
  // playhead but is still playing would leak its post-playhead text, so it is
  // dropped — closing the spoiler gap the old start-only filter left open.
  it("includes only fully-elapsed segments; the in-progress one is dropped", () => {
    // At playhead 10s, "three" (offset 10s, ends 11s) has only just STARTED, so
    // it is excluded — nothing past the playhead can leak.
    expect(sliceTranscriptToPlayhead(segments, 10, 2000)).toBe("one two");
    // Once it has fully elapsed (ends at 11s) it is included.
    const elapsed = sliceTranscriptToPlayhead(segments, 11, 2000);
    expect(elapsed).toBe("one two three");
    expect(elapsed).not.toContain("four");
  });

  it("keeps the most-recent segments when over the token cap", () => {
    // At playhead 11s "three" has fully elapsed and is eligible. tokenCap 2 →
    // charCap 8: "three" (6 incl. space) fits; adding "two" (→10) would exceed,
    // so older segments are dropped and the newest is kept whole.
    const text = sliceTranscriptToPlayhead(segments, 11, 2);
    expect(text).toBe("three");
  });

  it("returns empty string when nothing precedes the playhead", () => {
    expect(sliceTranscriptToPlayhead(segments, -1, 2000)).toBe("");
  });

  it("truncates a single oversized trailing segment to the cap tail", () => {
    const long: TranscriptSegment[] = [
      { text: "abcdefghij", offset: 0, duration: 1000 },
    ];
    const text = sliceTranscriptToPlayhead(long, 5, 1); // charCap 4
    expect(text).toBe("ghij");
  });
});
