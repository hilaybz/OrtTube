"use client";
import { useEffect, useRef } from "react";

export function TranscriptWarmer({
  quizId,
  classId,
}: {
  quizId: string;
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
