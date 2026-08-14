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
