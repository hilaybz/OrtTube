/**
 * `Tooltip` — the hover/keyboard label behind every `IconButton`. The bubble is
 * portaled to <body> with fixed viewport coordinates, because a `.glass` card
 * (`overflow: hidden`) used to clip it away entirely; and it must never outlive
 * the interaction that opened it, because a modal opening over the trigger
 * means no `mouseleave` ever arrives.
 */
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useState } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import { IconButton } from "@/components/ui/IconButton";
import { Modal } from "@/components/ui/Modal";

/**
 * jsdom has no layout, so every rect is zero unless stubbed. This gives the
 * trigger a real place on screen and the bubble a real size, which is what the
 * flip/clamp arithmetic reads.
 */
function stubRect(el: Element, rect: Partial<DOMRect>) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect);
}

function viewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
}

describe("Tooltip", () => {
  beforeEach(() => viewport(1024, 768));

  it("shows the label on hover and hides it on leave", async () => {
    render(<Tooltip content="מחיקת החידון"><button type="button">×</button></Tooltip>);
    const trigger = screen.getByRole("button");

    await userEvent.hover(trigger);
    expect(screen.getByRole("tooltip")).toHaveTextContent("מחיקת החידון");

    await userEvent.unhover(trigger);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("escapes its clipping ancestor: the bubble is portaled to <body>, positioned in viewport coordinates", async () => {
    render(
      <div className="glass">
        <Tooltip content="אנליטיקה"><button type="button">×</button></Tooltip>
      </div>
    );
    const trigger = screen.getByRole("button");
    stubRect(trigger.parentElement!, {
      top: 400,
      bottom: 436,
      left: 500,
      right: 536,
      width: 36,
      height: 36,
    });

    await userEvent.hover(trigger);
    const bubble = screen.getByRole("tooltip");
    // Not nested inside the `.glass` card that would have clipped it.
    expect(bubble.parentElement).toBe(document.body);
    expect(bubble).toHaveStyle({ position: "fixed" });
  });

  it("flips to the other side rather than being pushed off the top of the viewport", async () => {
    render(<Tooltip content="עריכה"><button type="button">×</button></Tooltip>);
    const trigger = screen.getByRole("button");
    // A control right at the top edge: there is no room above it.
    stubRect(trigger.parentElement!, {
      top: 4,
      bottom: 40,
      left: 500,
      right: 536,
      width: 36,
      height: 36,
    });

    await userEvent.hover(trigger);
    const bubble = screen.getByRole("tooltip");
    expect(bubble).toHaveAttribute("data-side", "bottom");
    // Placed under the trigger, and still inside the viewport.
    expect(Number.parseFloat(bubble.style.top)).toBeGreaterThanOrEqual(40);
  });

  it("clamps horizontally so a label at the end of a row is never cut off", async () => {
    render(<Tooltip content="ניקוי הסינון"><button type="button">×</button></Tooltip>);
    const trigger = screen.getByRole("button");
    // Flush against the right edge of a 1024px viewport.
    stubRect(trigger.parentElement!, {
      top: 300,
      bottom: 336,
      left: 1000,
      right: 1024,
      width: 24,
      height: 24,
    });

    await userEvent.hover(trigger);
    const bubble = screen.getByRole("tooltip");
    const left = Number.parseFloat(bubble.style.left);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left).toBeLessThanOrEqual(1024);
  });

  it("never truncates the label — a long one wraps inside a bounded width", async () => {
    render(
      <Tooltip content="החזרת החידון לכיתה ולפתיחה מחדש של חלון המענה">
        <button type="button">×</button>
      </Tooltip>
    );
    await userEvent.hover(screen.getByRole("button"));
    const bubble = screen.getByRole("tooltip");
    expect(bubble.className).not.toContain("truncate");
    expect(bubble.className).not.toContain("whitespace-nowrap");
    expect(bubble.className).toContain("max-w-[min(18rem,calc(100vw-1rem))]");
  });

  it("closes on Escape", async () => {
    render(<Tooltip content="עריכה"><button type="button">×</button></Tooltip>);
    await userEvent.hover(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("closes when the window loses focus", async () => {
    render(<Tooltip content="עריכה"><button type="button">×</button></Tooltip>);
    await userEvent.hover(screen.getByRole("button"));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    act(() => window.dispatchEvent(new Event("blur")));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("closes when the pointer turns up elsewhere while the trigger is not hovered", async () => {
    // The last line of defence for the same class of bug: an overlay drawn over
    // the trigger swallows the pointer without a `mouseleave` ever firing, so
    // any pointer movement outside a trigger that no longer matches `:hover`
    // retires the bubble.
    render(
      <div>
        <Tooltip content="עריכה">
          <button type="button">×</button>
        </Tooltip>
        <div data-testid="elsewhere">אחר</div>
      </div>
    );
    const trigger = screen.getByRole("button");
    await userEvent.hover(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    // jsdom keeps reporting the trigger as `:hover` after a synthetic hover, so
    // the browser's own answer — "the pointer is not over me any more" — has to
    // be stood in for here.
    vi.spyOn(trigger.parentElement!, "matches").mockReturnValue(false);
    act(() =>
      screen
        .getByTestId("elsewhere")
        .dispatchEvent(new PointerEvent("pointermove", { bubbles: true }))
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens on keyboard focus but not on the focus a click leaves behind", async () => {
    render(<IconButton name="edit" label="עריכה" />);
    await userEvent.tab();
    expect(screen.getByRole("tooltip")).toHaveTextContent("עריכה");

    // The same button clicked: the press dismisses the bubble, and the focus the
    // click leaves behind must not bring it straight back.
    await userEvent.click(screen.getByRole("button", { name: "עריכה" }));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("cannot outlive the hover that created it when a modal opens over the trigger", async () => {
    // The reported repro: the trash icon in "החידונים שלי" opens a confirmation
    // modal on top of itself, so the pointer never leaves the trigger and no
    // `mouseleave` ever fires. Cancelling the dialog used to leave the bubble
    // stuck on screen.
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <IconButton
            name="trash"
            label="מחיקת החידון"
            variant="danger"
            onClick={() => setOpen(true)}
          />
          <Modal open={open} title="מחיקת חידון" onClose={() => setOpen(false)}>
            <button type="button" onClick={() => setOpen(false)}>
              ביטול
            </button>
          </Modal>
        </>
      );
    }
    render(<Harness />);

    const trash = screen.getByRole("button", { name: "מחיקת החידון" });
    await userEvent.hover(trash);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    await userEvent.click(trash);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "ביטול" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Still gone — the bubble did not survive the dialog it opened.
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
