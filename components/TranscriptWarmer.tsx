"use client";
import { useEffect, useRef } from "react";

/**
 * Warms the transcript cache when a page that will later need it opens.
 *
 * Transcript fetching is lazy: nothing pulls one until a teacher presses
 * generate or a student asks the tutor. Both of those are moments when someone
 * is actively waiting, and a cold fetch is slow — proxy fallthrough, a ~1.2MB
 * watch page, then the download. Worse, a failure parks the single-flight claim
 * for ten minutes, so the person who triggered it waits and then gets nothing.
 *
 * Opening the editor or the player is the earliest reliable signal that the
 * transcript will probably be wanted, and nobody is blocked at that moment. So
 * this fires once, ignores the answer, and renders nothing.
 *
 * Rendering nothing is deliberate. There is no state worth showing: a warm hit
 * is instant and invisible, and a miss is not actionable by the person looking
 * at the page — the features that need a transcript already explain themselves
 * when it is missing.
 */
export function TranscriptWarmer({
  quizId,
  classId,
}: {
  quizId: string;
  /** Students are authorized by class membership; teachers by ownership. */
  classId?: string;
}) {
  // Effects run twice per mount under React Strict Mode in development, and a
  // re-render must not re-fire this either. The server's single-flight claim
  // would absorb a duplicate, but it would still cost a request.
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    // Deliberately NOT abortable on unmount. The point is the server-side
    // fetch-and-cache, which is worth finishing even if the teacher navigates
    // away a second later — aborting would cancel exactly the work this exists
    // to do. `keepalive` asks the browser to let it outlive the page for the
    // same reason.
    //
    // Not awaited and not surfaced: warming is best-effort, and an error here
    // must never reach a teacher opening the editor or a student opening a quiz.
    void fetch(`/api/quizzes/${quizId}/transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(classId ? { classId } : {}),
      keepalive: true,
    }).catch(() => {});
  }, [quizId, classId]);

  return null;
}
