/**
 * The one status treatment an allocation row wears, in every lifecycle state.
 *
 * These strings are the whole feature: a teacher should learn what happens
 * next from the chip alone, without a second date range beside it. So the test
 * pins the wording, the dual forms Hebrew actually uses ("שעתיים", not
 * "2 שעות"), and the point where a relative countdown gives way to a plain
 * date — plus the colour, which is what makes a row match its section: green
 * while students can reach the quiz, neutral once they can't.
 *
 * Every instant is built with the local-time `Date` constructor so the
 * calendar-day arithmetic ("מחר", "אתמול") holds in any timezone.
 */
import { describe, it, expect } from "vitest";
import {
  allocationStatus,
  formatShortDate,
  STATE_LABEL,
  STATE_VARIANT,
} from "@/components/teacher/scheduleFormat";

/** Monday 15 June 2026, midday, local. */
const NOW = new Date(2026, 5, 15, 12, 0, 0);

/** A local-time instant as the ISO string the RPC would have returned. */
function at(year: number, month: number, day: number, hour = 0, minute = 0): string {
  return new Date(year, month, day, hour, minute).toISOString();
}

function live(until: string | null, from: string | null = null) {
  return { published: true, available_from: from, available_until: until };
}

describe("allocationStatus — open", () => {
  it("counts the days down to the deadline", () => {
    const status = allocationStatus(live(at(2026, 5, 18, 12)), NOW);
    expect(status.state).toBe("live");
    expect(status.label).toBe("נסגר בעוד 3 ימים");
  });

  it("says tomorrow rather than 'in 1 day'", () => {
    expect(allocationStatus(live(at(2026, 5, 16, 9)), NOW).label).toBe("נסגר מחר");
  });

  it("names the hour for a deadline later today", () => {
    expect(allocationStatus(live(at(2026, 5, 15, 21, 30)), NOW).label).toBe(
      "נסגר היום בשעה 21:30"
    );
  });

  it("uses the Hebrew dual form for two hours", () => {
    expect(allocationStatus(live(at(2026, 5, 15, 14)), NOW).label).toBe(
      "נסגר בעוד שעתיים"
    );
  });

  it("drops to minutes in the last hour", () => {
    expect(allocationStatus(live(at(2026, 5, 15, 12, 40)), NOW).label).toBe(
      "נסגר בעוד 40 דקות"
    );
  });

  it("gives an absolute date once the deadline is more than a week out", () => {
    expect(allocationStatus(live(at(2026, 6, 6, 9)), NOW).label).toBe("נסגר ב־6.7");
  });

  it("says so plainly when there is no deadline at all", () => {
    expect(allocationStatus(live(null), NOW).label).toBe("פעיל · ללא מועד סיום");
  });

  it("reads green, matching the section open quizzes sit in", () => {
    const status = allocationStatus(live(at(2026, 5, 18, 12)), NOW);
    expect(status.variant).toBe("success");
    expect(status.icon).toBe("timer");
  });
});

describe("allocationStatus — scheduled", () => {
  it("counts down to the opening, not the closing", () => {
    const status = allocationStatus(
      live(at(2026, 5, 30, 12), at(2026, 5, 16, 8)),
      NOW
    );
    expect(status.state).toBe("scheduled");
    expect(status.label).toBe("נפתח מחר");
    expect(status.variant).toBe("warning");
  });
});

describe("allocationStatus — ended", () => {
  it("reads back the closing as a past event", () => {
    const status = allocationStatus(live(at(2026, 5, 14, 9)), NOW);
    expect(status.state).toBe("done");
    expect(status.label).toBe("הסתיים אתמול");
    // Neutral, not green: a closed window is settled, not a success.
    expect(status.variant).toBe("gray");
    expect(status.icon).toBe("checkCircle");
  });

  it("counts the days back within the week", () => {
    expect(allocationStatus(live(at(2026, 5, 12, 9)), NOW).label).toBe(
      "הסתיים לפני 3 ימים"
    );
  });

  it("carries the year on a date outside the current one", () => {
    expect(allocationStatus(live(at(2025, 7, 26, 10)), NOW).label).toBe(
      "הסתיים ב־26.8.2025"
    );
  });
});

describe("allocationStatus — withdrawn from students", () => {
  it("says why the row is greyed out, whatever its window says", () => {
    const status = allocationStatus(
      { published: false, available_from: null, available_until: at(2026, 5, 14, 9) },
      NOW
    );
    expect(status.state).toBe("draft");
    expect(status.label).toBe("מוסתר מתלמידים");
    expect(status.variant).toBe("gray");
  });
});

describe("formatShortDate", () => {
  it("omits the year within the current one and keeps it outside", () => {
    expect(formatShortDate(new Date(2026, 7, 26), NOW)).toBe("26.8");
    expect(formatShortDate(new Date(2025, 7, 26), NOW)).toBe("26.8.2025");
  });
});

describe("state chip", () => {
  it("colours a state the same way the richer status treatment does", () => {
    for (const state of ["draft", "scheduled", "live", "done"] as const) {
      expect(STATE_VARIANT[state]).toBe(
        allocationStatus(
          {
            published: state !== "draft",
            available_from:
              state === "scheduled" ? "2026-07-01T00:00:00.000Z" : null,
            available_until:
              state === "done" ? "2026-05-01T00:00:00.000Z" : null,
          },
          NOW
        ).variant
      );
    }
  });

  it("names a withdrawn allocation for what it does, not for an authoring stage", () => {
    expect(STATE_LABEL.draft).toBe("מוסתר");
  });
});
