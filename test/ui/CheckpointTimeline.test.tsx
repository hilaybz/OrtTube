/**
 * `CheckpointTimeline` in isolation — plain numbers/callbacks, no
 * `react-youtube`/`VideoStage` involved. Pins the proportional math, the
 * click-vs-marker-vs-drag disambiguation, and the same-timestamp clustering
 * (a stack marker regardless of N, never N overlapping dots).
 */
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { CheckpointTimeline, type TimelineMarker } from "@/components/video/CheckpointTimeline";

// jsdom has no layout engine, so every element reports a 0×0 rect by
// default — stub the track's rect to a known, easy-to-reason-about size.
// Duration 300 over width 300 makes 1px == 1 second.
const TRACK_RECT = { left: 0, width: 300 } as DOMRect;

function stubTrackRect() {
  const track = screen.getByTestId("timeline-track");
  vi.spyOn(track, "getBoundingClientRect").mockReturnValue(TRACK_RECT);
  return track;
}

beforeEach(() => {
  // jsdom doesn't implement pointer capture; the component calls it
  // unconditionally on drag-start, so it must exist even as a no-op.
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

describe("CheckpointTimeline", () => {
  it("renders a skeleton with no markers and inert clicks when duration is unknown", async () => {
    const onSeek = vi.fn();
    render(
      <CheckpointTimeline
        durationSeconds={null}
        currentSeconds={0}
        markers={[{ id: "q1", seconds: 50, label: "שאלה 1" }]}
        onSeek={onSeek}
      />
    );
    const track = screen.getByTestId("timeline-track");
    expect(track).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByTestId("timeline-marker")).not.toBeInTheDocument();
    expect(screen.queryByTestId("timeline-cluster")).not.toBeInTheDocument();

    await userEvent.click(track);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("places a lone marker proportionally to duration", () => {
    render(
      <CheckpointTimeline
        durationSeconds={300}
        currentSeconds={0}
        markers={[{ id: "q1", seconds: 75, label: "שאלה 1" }]}
        onSeek={vi.fn()}
      />
    );
    const marker = screen.getByTestId("timeline-marker").parentElement as HTMLElement;
    expect(marker.style.left).toBe("25%"); // 75/300
  });

  it("clicking empty track seeks; clicking a lone marker calls onMarkerClick, not onSeek", async () => {
    const onSeek = vi.fn();
    const onMarkerClick = vi.fn();
    render(
      <CheckpointTimeline
        durationSeconds={300}
        currentSeconds={0}
        markers={[{ id: "q1", seconds: 100, label: "שאלה 1" }]}
        onSeek={onSeek}
        onMarkerClick={onMarkerClick}
      />
    );
    const track = stubTrackRect();

    fireEvent.pointerDown(track, { clientX: 150 });
    expect(onSeek).toHaveBeenCalledWith(150);
    expect(onMarkerClick).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("timeline-marker"));
    expect(onMarkerClick).toHaveBeenCalledWith("q1", 100);
    expect(onSeek).toHaveBeenCalledTimes(1); // still just the track click
  });

  it("falls back to onSeek when onMarkerClick is omitted", async () => {
    const onSeek = vi.fn();
    render(
      <CheckpointTimeline
        durationSeconds={300}
        currentSeconds={0}
        markers={[{ id: "q1", seconds: 100, label: "שאלה 1" }]}
        onSeek={onSeek}
      />
    );
    await userEvent.click(screen.getByTestId("timeline-marker"));
    expect(onSeek).toHaveBeenCalledWith(100);
  });

  describe("same-timestamp clustering", () => {
    const twoAtOnce: TimelineMarker[] = [
      { id: "q1", seconds: 100, label: "שאלה 1" },
      { id: "q2", seconds: 100, label: "שאלה 2" },
    ];

    it("renders one stack marker with a count badge, not two overlapping markers", () => {
      render(
        <CheckpointTimeline
          durationSeconds={300}
          currentSeconds={0}
          markers={twoAtOnce}
          onSeek={vi.fn()}
        />
      );
      expect(screen.queryAllByTestId("timeline-marker")).toHaveLength(0);
      const clusters = screen.getAllByTestId("timeline-cluster");
      expect(clusters).toHaveLength(1);
      expect(clusters[0]).toHaveTextContent("2");
    });

    it("four questions at the same instant still render as a single stack, badge reads 4", () => {
      const four: TimelineMarker[] = [0, 1, 2, 3].map((i) => ({
        id: `q${i}`,
        seconds: 100,
        label: `שאלה ${i + 1}`,
      }));
      render(
        <CheckpointTimeline
          durationSeconds={300}
          currentSeconds={0}
          markers={four}
          onSeek={vi.fn()}
        />
      );
      expect(screen.getAllByTestId("timeline-cluster")).toHaveLength(1);
      expect(screen.getByTestId("timeline-cluster")).toHaveTextContent("4");
    });

    it("a cluster of 10+ shows a 9+ pill instead of the raw count", () => {
      const ten: TimelineMarker[] = Array.from({ length: 10 }, (_, i) => ({
        id: `q${i}`,
        seconds: 100,
        label: `שאלה ${i + 1}`,
      }));
      render(
        <CheckpointTimeline
          durationSeconds={300}
          currentSeconds={0}
          markers={ten}
          onSeek={vi.fn()}
        />
      );
      expect(screen.getByTestId("timeline-cluster")).toHaveTextContent("9+");
    });

    it("clicking the stack opens a popover listing every clustered question; picking one selects it and closes the popover", async () => {
      const onMarkerClick = vi.fn();
      render(
        <CheckpointTimeline
          durationSeconds={300}
          currentSeconds={0}
          markers={twoAtOnce}
          onSeek={vi.fn()}
          onMarkerClick={onMarkerClick}
        />
      );
      await userEvent.click(screen.getByTestId("timeline-cluster"));
      const menu = screen.getByRole("menu");
      const items = within(menu).getAllByRole("menuitem");
      expect(items).toHaveLength(2);
      expect(items[0]).toHaveTextContent("שאלה 1");
      expect(items[1]).toHaveTextContent("שאלה 2");

      await userEvent.click(items[1]);
      expect(onMarkerClick).toHaveBeenCalledWith("q2", 100);
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });

    it("closes the popover on an outside click without firing a selection", async () => {
      const onMarkerClick = vi.fn();
      render(
        <div>
          <button type="button">outside</button>
          <CheckpointTimeline
            durationSeconds={300}
            currentSeconds={0}
            markers={twoAtOnce}
            onSeek={vi.fn()}
            onMarkerClick={onMarkerClick}
          />
        </div>
      );
      await userEvent.click(screen.getByTestId("timeline-cluster"));
      expect(screen.getByRole("menu")).toBeInTheDocument();

      await userEvent.click(screen.getByText("outside"));
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      expect(onMarkerClick).not.toHaveBeenCalled();
    });

    it("closes the popover on Escape", async () => {
      render(
        <CheckpointTimeline
          durationSeconds={300}
          currentSeconds={0}
          markers={twoAtOnce}
          onSeek={vi.fn()}
        />
      );
      await userEvent.click(screen.getByTestId("timeline-cluster"));
      expect(screen.getByRole("menu")).toBeInTheDocument();

      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });

  describe("dragging", () => {
    const marker: TimelineMarker[] = [{ id: "q1", seconds: 100, label: "שאלה 1" }];

    it("a small movement below the threshold is treated as a click, not a drag", () => {
      const onMarkerClick = vi.fn();
      const onMarkerMove = vi.fn();
      render(
        <CheckpointTimeline
          durationSeconds={300}
          currentSeconds={0}
          markers={marker}
          onSeek={vi.fn()}
          onMarkerClick={onMarkerClick}
          onMarkerMove={onMarkerMove}
          draggableIds={new Set(["q1"])}
        />
      );
      stubTrackRect();
      const m = screen.getByTestId("timeline-marker");

      fireEvent.pointerDown(m, { clientX: 100, pointerId: 1 });
      fireEvent.pointerMove(m, { clientX: 102, pointerId: 1 }); // 2px, below the 5px threshold
      fireEvent.pointerUp(m, { clientX: 102, pointerId: 1 });

      expect(onMarkerMove).not.toHaveBeenCalled();
      expect(onMarkerClick).toHaveBeenCalledWith("q1", 100);
    });

    it("a movement past the threshold commits a move on drop, not a click", () => {
      const onMarkerClick = vi.fn();
      const onMarkerMove = vi.fn();
      render(
        <CheckpointTimeline
          durationSeconds={300}
          currentSeconds={0}
          markers={marker}
          onSeek={vi.fn()}
          onMarkerClick={onMarkerClick}
          onMarkerMove={onMarkerMove}
          draggableIds={new Set(["q1"])}
        />
      );
      stubTrackRect();
      const m = screen.getByTestId("timeline-marker");

      fireEvent.pointerDown(m, { clientX: 100, pointerId: 1 });
      fireEvent.pointerMove(m, { clientX: 150, pointerId: 1 }); // 50px = 50s past threshold
      fireEvent.pointerUp(m, { clientX: 150, pointerId: 1 });

      expect(onMarkerMove).toHaveBeenCalledWith("q1", 150);
      expect(onMarkerClick).not.toHaveBeenCalled();
    });

    it("clamps a drag to the track bounds", () => {
      const onMarkerMove = vi.fn();
      render(
        <CheckpointTimeline
          durationSeconds={300}
          currentSeconds={0}
          markers={marker}
          onSeek={vi.fn()}
          onMarkerMove={onMarkerMove}
          draggableIds={new Set(["q1"])}
        />
      );
      stubTrackRect();
      const m = screen.getByTestId("timeline-marker");

      fireEvent.pointerDown(m, { clientX: 100, pointerId: 1 });
      fireEvent.pointerMove(m, { clientX: 9999, pointerId: 1 });
      fireEvent.pointerUp(m, { clientX: 9999, pointerId: 1 });

      expect(onMarkerMove).toHaveBeenCalledWith("q1", 300);
    });

    it("a marker not in draggableIds ignores drag pointer sequences and is still clickable", () => {
      const onMarkerClick = vi.fn();
      const onMarkerMove = vi.fn();
      render(
        <CheckpointTimeline
          durationSeconds={300}
          currentSeconds={0}
          markers={marker}
          onSeek={vi.fn()}
          onMarkerClick={onMarkerClick}
          onMarkerMove={onMarkerMove}
          draggableIds={new Set()} // q1 not included
        />
      );
      stubTrackRect();
      const m = screen.getByTestId("timeline-marker");

      fireEvent.pointerDown(m, { clientX: 100, pointerId: 1 });
      fireEvent.pointerMove(m, { clientX: 150, pointerId: 1 });
      fireEvent.pointerUp(m, { clientX: 150, pointerId: 1 });
      expect(onMarkerMove).not.toHaveBeenCalled();

      fireEvent.click(m);
      expect(onMarkerClick).toHaveBeenCalledWith("q1", 100);
    });

    it("a clustered marker ignores drag sequences — clicking only toggles the popover", async () => {
      const onMarkerMove = vi.fn();
      render(
        <CheckpointTimeline
          durationSeconds={300}
          currentSeconds={0}
          markers={[
            { id: "q1", seconds: 100, label: "שאלה 1" },
            { id: "q2", seconds: 100, label: "שאלה 2" },
          ]}
          onSeek={vi.fn()}
          onMarkerMove={onMarkerMove}
          draggableIds={new Set(["q1", "q2"])}
        />
      );
      const stack = screen.getByTestId("timeline-cluster");

      fireEvent.pointerDown(stack, { clientX: 100, pointerId: 1 });
      fireEvent.pointerMove(stack, { clientX: 150, pointerId: 1 });
      fireEvent.pointerUp(stack, { clientX: 150, pointerId: 1 });
      expect(onMarkerMove).not.toHaveBeenCalled();
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();

      await userEvent.click(stack);
      expect(screen.getByRole("menu")).toBeInTheDocument();
    });
  });

  it("reflects activeMarkerId on the matching marker", () => {
    render(
      <CheckpointTimeline
        durationSeconds={300}
        currentSeconds={0}
        markers={[
          { id: "q1", seconds: 50, label: "שאלה 1" },
          { id: "q2", seconds: 200, label: "שאלה 2" },
        ]}
        activeMarkerId="q2"
        onSeek={vi.fn()}
      />
    );
    const [m1, m2] = screen.getAllByTestId("timeline-marker");
    expect(m1).not.toHaveAttribute("aria-current");
    expect(m2).toHaveAttribute("aria-current", "true");
  });

  it("clamps the playhead position when currentSeconds exceeds duration", () => {
    const { container } = render(
      <CheckpointTimeline
        durationSeconds={200}
        currentSeconds={999}
        markers={[]}
        onSeek={vi.fn()}
      />
    );
    const playhead = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(playhead.style.left).toBe("100%");
  });
});
