/**
 * The wording of a submission deadline, on both sides of it. Pure — no DB, no
 * React — and pinned at a fixed instant, 11:00 Israeli time on Saturday 14
 * March 2026, so "today" and "tomorrow" mean the same thing on every machine
 * that runs this (the helpers answer calendar questions in the school's zone,
 * which is exactly the part a UTC-machine test would otherwise get wrong).
 */
import { describe, it, expect } from "vitest";
import {
  countdownTickMs,
  deadlineView,
  formatRemaining,
  formatSchoolDate,
  formatDeadlineClock,
} from "@/components/student/deadline";

const NOW = new Date("2026-03-14T09:00:00.000Z");
const minutes = (n: number) => n * 60_000;
const hours = (n: number) => n * 3_600_000;
const days = (n: number) => n * 86_400_000;

describe("formatRemaining", () => {
  it("counts the last hour as mm:ss, the figure a student watches", () => {
    expect(formatRemaining(minutes(30))).toBe("30:00");
    expect(formatRemaining(minutes(1) + 5000)).toBe("1:05");
    expect(formatRemaining(45_000)).toBe("0:45");
  });

  it("counts hours and days in words, with Hebrew's own dual forms", () => {
    expect(formatRemaining(hours(1))).toBe("שעה");
    expect(formatRemaining(hours(2))).toBe("שעתיים");
    expect(formatRemaining(hours(3) + minutes(1))).toBe("3 שעות ודקה");
    expect(formatRemaining(hours(3) + minutes(2))).toBe("3 שעות ושתי דקות");
    expect(formatRemaining(days(1))).toBe("יום");
    expect(formatRemaining(days(2) + hours(2))).toBe("יומיים ושעתיים");
    expect(formatRemaining(days(2) + hours(3))).toBe("יומיים ו-3 שעות");
    expect(formatRemaining(days(4))).toBe("4 ימים");
  });

  it("has nothing to report once the window has closed", () => {
    expect(formatRemaining(0)).toBeNull();
    expect(formatRemaining(-minutes(5))).toBeNull();
  });
});

describe("countdownTickMs", () => {
  it("repaints at the granularity actually on screen", () => {
    expect(countdownTickMs(minutes(30))).toBe(1000);
    expect(countdownTickMs(hours(5))).toBe(30_000);
    expect(countdownTickMs(days(3))).toBe(60_000);
  });
});

describe("school-zone formatting", () => {
  it("reads a UTC instant as the school's own wall clock and date", () => {
    // 18:00 UTC is 20:00 in Jerusalem, still the same calendar day there.
    expect(formatDeadlineClock("2026-03-10T18:00:00.000Z")).toBe("20:00");
    expect(formatSchoolDate("2026-03-10T18:00:00.000Z")).toBe("10.3");
    // 22:30 UTC has already become the next day in Jerusalem.
    expect(formatSchoolDate("2026-03-10T22:30:00.000Z")).toBe("11.3");
  });
});

describe("deadlineView", () => {
  it("names today by the day, not by the hours left", () => {
    const view = deadlineView("2026-03-14T20:00:00.000Z", NOW);
    expect(view.lead).toBe("היום");
    expect(view.day).toBe("היום");
    expect(view.exact).toBe("עד 22:00");
    expect(view.when).toBe("היום · עד 22:00");
    // Nine hours out is not yet urgent, but it is not calm either.
    expect(view.urgency).toBe("soon");
  });

  it("switches to the ticking figure inside the last hour, and turns urgent", () => {
    const view = deadlineView("2026-03-14T09:30:00.000Z", NOW);
    expect(view.lead).toBe("נותרו 30:00");
    // The day is still available separately, for a countdown that needs it.
    expect(view.day).toBe("היום");
    expect(view.urgency).toBe("urgent");
  });

  it("treats a few hours away as urgent even before the last hour", () => {
    expect(deadlineView("2026-03-14T13:00:00.000Z", NOW).urgency).toBe("urgent");
  });

  it("names tomorrow, and keeps the date out of an hour that needs no date", () => {
    const view = deadlineView("2026-03-15T16:00:00.000Z", NOW);
    expect(view.lead).toBe("מחר");
    expect(view.exact).toBe("עד 18:00");
    expect(view.urgency).toBe("soon");
  });

  it("counts further deadlines in days and dates the hour, calmly", () => {
    const view = deadlineView("2026-03-17T16:00:00.000Z", NOW);
    expect(view.lead).toBe("בעוד 3 ימים");
    expect(view.exact).toBe("17.3 בשעה 18:00");
    expect(view.when).toBe("17.3 בשעה 18:00");
    expect(view.urgency).toBe("calm");
  });

  it("counts calendar days, not 24-hour blocks — late tonight is still today", () => {
    // 23:30 Israeli time on the same day: barely half a day away, but "היום".
    expect(deadlineView("2026-03-14T21:30:00.000Z", NOW).day).toBe("היום");
    // 00:30 the next morning is barely later, and is "מחר".
    expect(deadlineView("2026-03-14T22:30:00.000Z", NOW).day).toBe("מחר");
  });

  it("says the moment has passed rather than counting down through zero", () => {
    const view = deadlineView("2026-03-13T16:00:00.000Z", NOW);
    expect(view.lead).toBe("המועד עבר");
    expect(view.urgency).toBe("passed");
    expect(view.exact).toBe("13.3 בשעה 18:00");
  });
});
