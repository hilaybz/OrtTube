/**
 * `MultiSelectDropdown` — the checkbox-panel multi-select, used wherever a
 * `Pill` row would otherwise wrap into several lines once the option list
 * grows (e.g. the quiz library's class filter with a large class roster).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { MultiSelectDropdown } from "@/components/ui/MultiSelectDropdown";

const OPTIONS = [
  { value: "a", label: "אלף" },
  { value: "b", label: "בית" },
  { value: "c", label: "גימל" },
];

function Harness({ initial = new Set<string>() }: { initial?: Set<string> }) {
  const [selected, setSelected] = useState(initial);
  return (
    <div>
      <MultiSelectDropdown
        label="בחירה"
        options={OPTIONS}
        selected={selected}
        onChange={setSelected}
      />
      <p>נבחרו: {[...selected].join(",") || "כלום"}</p>
    </div>
  );
}

describe("MultiSelectDropdown", () => {
  it("shows the empty label when nothing is selected, and starts closed", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "בחירה" })).toHaveTextContent("הכל");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("opens the panel on click and lists every option as a checkbox", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "בחירה" }));
    expect(screen.getByRole("checkbox", { name: "אלף" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "בית" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "גימל" })).toBeInTheDocument();
  });

  it("checking an option updates the caller's selection and the trigger summary", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "בחירה" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "אלף" }));
    expect(screen.getByText("נבחרו: a")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "בחירה" })).toHaveTextContent("אלף");
  });

  it("shows a count once more than one option is selected", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "בחירה" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "אלף" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "בית" }));
    expect(screen.getByRole("button", { name: "בחירה" })).toHaveTextContent("2 נבחרו");
  });

  it("unchecking removes it from the selection", async () => {
    render(<Harness initial={new Set(["a", "b"])} />);
    await userEvent.click(screen.getByRole("button", { name: "בחירה" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "אלף" }));
    expect(screen.getByText("נבחרו: b")).toBeInTheDocument();
  });

  it("stays open across several checkbox clicks in a row", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "בחירה" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "אלף" }));
    // Still open — the panel isn't dismissed by a click inside it.
    expect(screen.getByRole("checkbox", { name: "בית" })).toBeInTheDocument();
  });

  it("closes on an outside click", async () => {
    render(
      <div>
        <Harness />
        <button type="button">מחוץ</button>
      </div>
    );
    await userEvent.click(screen.getByRole("button", { name: "בחירה" }));
    expect(screen.getByRole("checkbox", { name: "אלף" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "מחוץ" }));
    expect(screen.queryByRole("checkbox", { name: "אלף" })).not.toBeInTheDocument();
  });

  it("sizes the panel to its own content instead of a fixed width", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "בחירה" }));
    const panel = screen.getByRole("checkbox", { name: "אלף" }).closest("div")!;
    // A filter over short class names must not be a slab far wider than
    // anything in it: the panel is `w-max` between a min and a max, and its
    // inline style only ever carries the position it was measured into.
    expect(panel.className).toContain("w-max");
    expect(panel.className).not.toContain("w-56");
    expect(panel.style.width).toBe("");
  });

  it("closes on Escape", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "בחירה" }));
    expect(screen.getByRole("checkbox", { name: "אלף" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("checkbox", { name: "אלף" })).not.toBeInTheDocument();
  });
});
