/**
 * Unit tests for `allocationState` (no DB) — the pure TypeScript mirror of
 * the SQL `_allocation_is_live` predicate (128_class_quiz_scheduling_window.sql).
 * Pinned to the exact same boundary the SQL helper uses so the two can't
 * silently drift: `available_until === now` is `done`, not `live` (`>`, not
 * `>=`), and `available_from === now` is already open (`<=`, not `<`).
 */
import { describe, it, expect } from "vitest";
import { allocationState } from "@/lib/allocationState";

const NOW = new Date("2026-08-13T12:00:00.000Z");
const PAST = "2026-08-13T11:00:00.000Z";
const FUTURE = "2026-08-13T13:00:00.000Z";

describe("allocationState", () => {
  it("is draft when unpublished, regardless of any window", () => {
    expect(
      allocationState({ published: false, available_from: null, available_until: null }, NOW)
    ).toBe("draft");
    expect(
      allocationState(
        { published: false, available_from: PAST, available_until: FUTURE },
        NOW
      )
    ).toBe("draft");
  });

  it("is live when published with no window at all", () => {
    expect(
      allocationState(
        { published: true, available_from: null, available_until: null },
        NOW
      )
    ).toBe("live");
  });

  it("is live when published and inside an open window", () => {
    expect(
      allocationState(
        { published: true, available_from: PAST, available_until: FUTURE },
        NOW
      )
    ).toBe("live");
  });

  it("is scheduled when published but available_from is still ahead", () => {
    expect(
      allocationState(
        { published: true, available_from: FUTURE, available_until: null },
        NOW
      )
    ).toBe("scheduled");
  });

  it("is done when published but available_until has passed", () => {
    expect(
      allocationState(
        { published: true, available_from: null, available_until: PAST },
        NOW
      )
    ).toBe("done");
  });

  it("boundary: available_from exactly now is already open (live), not scheduled", () => {
    expect(
      allocationState(
        { published: true, available_from: NOW.toISOString(), available_until: null },
        NOW
      )
    ).toBe("live");
  });

  it("boundary: available_until exactly now is already closed (done), not live", () => {
    expect(
      allocationState(
        { published: true, available_from: null, available_until: NOW.toISOString() },
        NOW
      )
    ).toBe("done");
  });

  it("defaults `now` to the current time when omitted", () => {
    // Just a smoke check that the default parameter path doesn't throw and
    // returns a valid state — the boundary cases above already pin the logic.
    const state = allocationState({
      published: true,
      available_from: null,
      available_until: null,
    });
    expect(["draft", "scheduled", "live", "done"]).toContain(state);
  });
});
