/**
 * Edpuzzle-style block-skip gate decision. A student may watch/rewind freely up
 * to the current unanswered checkpoint, but may not advance past it. Returns
 * whether the checkpoint is reached (show the question) and, if the playhead ran
 * past it, the position to snap back to. Pure + unit-tested.
 */
export function gateDecision(
  playhead: number,
  gatePos: number | null
): { atGate: boolean; clampTo: number | null } {
  if (gatePos == null) return { atGate: false, clampTo: null };
  const clampTo = playhead > gatePos + 0.4 ? gatePos : null;
  const effective = clampTo != null ? gatePos : playhead;
  return { atGate: effective >= gatePos - 0.05, clampTo };
}

/**
 * The other half of the same rule, asked forwards: may the student jump to
 * this instant? Anything up to and including the gate is theirs to re-watch;
 * anything past it is exactly what the gate exists to withhold. `null` gate
 * means every question is answered, so the whole video is open.
 *
 * `VideoStage.seekTo` clamps to `maxSeek` regardless, so this is not what
 * *enforces* the gate — it is what keeps a forbidden checkpoint from being
 * dressed up as a control the student can press (a click that silently lands
 * somewhere else is worse than no click at all).
 */
export function canSeekTo(seconds: number, gatePos: number | null): boolean {
  return gatePos == null || seconds <= gatePos + 0.05;
}
