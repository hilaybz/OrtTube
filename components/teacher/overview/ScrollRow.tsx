import { cn } from "@/components/ui/cn";

/**
 * A single horizontally scrolling row of cards, used instead of a wrapping grid
 * so a section stays one band tall no matter how many quizzes it holds.
 *
 * Plain scroll, deliberately: no arrow buttons, no edge gradient, no scrollbar
 * track running under the row. Touch, trackpad, wheel and arrow keys all pan it
 * already, and overlay controls sat on top of the cards they were meant to
 * reveal. The cards themselves are the affordance — the next one peeks in at
 * the edge, which is what tells the teacher the row continues.
 *
 * RTL comes for free: the row inherits the document's direction, so it starts
 * scrolled to the right edge and "next" is leftward. `tabIndex={0}` on the
 * scroll container is the accessibility requirement for a scrollable region —
 * without it a keyboard-only user can pan the row with the arrow keys only by
 * tabbing through the cards inside it, and a row of non-focusable content could
 * not be reached at all.
 */
export function ScrollRow({
  label,
  className,
  children,
}: {
  /** Names the region for assistive tech, e.g. "החידונים הפעילים שלי". */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      tabIndex={0}
      className={cn(
        "-mx-1 flex snap-x snap-mandatory gap-5 overflow-x-auto px-1 pb-3",
        // Scrolling works; the bar itself is hidden in all three engines.
        "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {children}
    </div>
  );
}

/** One snap-aligned cell of a `ScrollRow`, sized so the next card peeks in. */
export function ScrollRowItem({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-[17rem] flex-none snap-start sm:w-[19rem]">{children}</div>
  );
}
