"use client";
import { useEffect, useState } from "react";
import { StatusBlock } from "./StatusBlock";
import { countdownTickMs, deadlineView, formatRemaining, URGENCY_TONE } from "./deadline";

export function DeadlineCountdown({
  availableUntil,
  clockOffsetMs = 0,
  className,
}: {
  availableUntil: string | null;
  clockOffsetMs?: number;
  className?: string;
}) {
  // The countdown's own clock, in state rather than read off `Date.now()` at
  // render time: rendering has to be pure, so the impurity lives in the tick
  // below (and in the one-time seed, which is where the caller's server offset
  // is applied). Re-reading the real clock on every tick rather than adding the
  // interval keeps a throttled background tab from drifting.
  const [now, setNow] = useState(() => Date.now() + clockOffsetMs);
  const deadlineMs = availableUntil ? new Date(availableUntil).getTime() : null;
  const msLeft = deadlineMs != null ? deadlineMs - now : null;

  useEffect(() => {
    if (msLeft == null || msLeft <= 0) return;
    const t = setTimeout(
      () => setNow(Date.now() + clockOffsetMs),
      countdownTickMs(msLeft)
    );
    return () => clearTimeout(t);
  }, [msLeft, clockOffsetMs]);

  if (!availableUntil) {
    return (
      <StatusBlock
        className={className}
        icon="clock"
        tone="neutral"
        headline="ללא מועד הגשה"
        meta="אפשר לסיים מתי שנוח לך"
      />
    );
  }

  const view = deadlineView(availableUntil, new Date(now));
  const remaining = msLeft != null ? formatRemaining(msLeft) : null;

  if (remaining == null) {
    return (
      <StatusBlock
        className={className}
        icon="timer"
        tone="danger"
        headline="המועד עבר"
        meta={`מועד ההגשה היה ${view.exact}`}
      />
    );
  }

  return (
    <StatusBlock
      className={className}
      icon={view.urgency === "calm" ? "clock" : "timer"}
      tone={URGENCY_TONE[view.urgency]}
      strong
      headline={
        <>
          נותרו <span className="tabular-nums">{remaining}</span>
        </>
      }
      meta={`מועד הגשה · ${view.when}`}
    />
  );
}
