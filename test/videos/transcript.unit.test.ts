import { describe, it, expect } from "vitest";
import {
  sliceTranscriptToPlayhead,
  normalizeLang,
  type TranscriptSegment,
} from "../../lib/transcript";

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
    { text: "four", offset: 20000, duration: 1000 },
  ];

  it("includes only fully-elapsed segments; the in-progress one is dropped", () => {
    expect(sliceTranscriptToPlayhead(segments, 10, 2000)).toBe("one two");
    const elapsed = sliceTranscriptToPlayhead(segments, 11, 2000);
    expect(elapsed).toBe("one two three");
    expect(elapsed).not.toContain("four");
  });

  it("keeps the most-recent segments when over the token cap", () => {
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
    const text = sliceTranscriptToPlayhead(long, 5, 1);
    expect(text).toBe("ghij");
  });
});
