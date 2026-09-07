import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { Sidebar } from "@/components/shell/Sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/classes",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("Sidebar", () => {
  const items = [
    { href: "/dashboard", label: "סקירה", icon: "grid" as const },
    { href: "/dashboard/classes", label: "כיתות", icon: "class" as const },
  ];

  function rail() {
    return document.querySelector("aside")!;
  }

  it("marks the active route with aria-current=page (nested match)", () => {
    render(<Sidebar items={items} brand="OrtTube" />);
    expect(screen.getByRole("link", { name: /כיתות/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /סקירה/ })).not.toHaveAttribute("aria-current");
  });

  it("pins sign-out to the sidebar", () => {
    render(<Sidebar items={items} brand="OrtTube" />);
    expect(screen.getByRole("button", { name: "יציאה" })).toBeInTheDocument();
  });

  it("keeps every nav label in the accessibility tree while resting at icon width", () => {
    render(<Sidebar items={items} brand="OrtTube" />);
    expect(rail()).not.toHaveAttribute("data-expanded");
    expect(screen.getByRole("link", { name: /כיתות/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "יציאה" })).toBeInTheDocument();
  });

  it("expands on hover and collapses again when the pointer leaves", async () => {
    render(<Sidebar items={items} brand="OrtTube" />);
    await userEvent.hover(rail());
    expect(rail()).toHaveAttribute("data-expanded", "true");

    await userEvent.unhover(rail());
    expect(rail()).not.toHaveAttribute("data-expanded");
  });

  it("floats over the page instead of reflowing it: the rail is fixed and only ever icon-width in the flow", async () => {
    render(<Sidebar items={items} brand="OrtTube" />);
    expect(rail().className).toContain("fixed");
    expect(rail().className).toContain("md:w-[5.25rem]");
    await userEvent.hover(rail());
    expect(rail().className).not.toContain("md:w-[5.25rem]");
    expect(rail().className).toContain("w-64");
  });

  it("scrolls its own content rather than the page", () => {
    render(<Sidebar items={items} brand="OrtTube" />);
    const scroller = rail().firstElementChild!;
    expect(scroller.className).toContain("overflow-y-auto");
    expect(scroller.className).toContain("overscroll-contain");
  });

  it("stays expanded while focus is anywhere inside it, so it can be tabbed through", async () => {
    render(<Sidebar items={items} brand="OrtTube" />);
    await userEvent.tab();
    expect(screen.getByRole("link", { name: /סקירה/ })).toHaveFocus();
    expect(rail()).toHaveAttribute("data-expanded", "true");

    await userEvent.tab();
    expect(screen.getByRole("link", { name: /כיתות/ })).toHaveFocus();
    expect(rail()).toHaveAttribute("data-expanded", "true");
  });

  it("collapses after a nav row is CLICKED and the pointer leaves", async () => {
    render(<Sidebar items={items} brand="OrtTube" />);
    await userEvent.hover(rail());
    await userEvent.click(screen.getByRole("link", { name: /כיתות/ }));
    expect(rail()).toHaveAttribute("data-expanded", "true");

    await userEvent.unhover(rail());
    expect(rail()).not.toHaveAttribute("data-expanded");
  });

  it("still opens for a keyboard user after a click has happened", async () => {
    render(<Sidebar items={items} brand="OrtTube" />);
    await userEvent.click(screen.getByRole("link", { name: /כיתות/ }));
    await userEvent.unhover(rail());
    expect(rail()).not.toHaveAttribute("data-expanded");

    await userEvent.tab();
    expect(rail()).toHaveAttribute("data-expanded", "true");
  });

  it("collapses once focus leaves the rail entirely", async () => {
    render(
      <div>
        <Sidebar items={items} brand="OrtTube" />
        <button type="button">מחוץ</button>
      </div>
    );
    await userEvent.tab();
    expect(rail()).toHaveAttribute("data-expanded", "true");

    await userEvent.click(screen.getByRole("button", { name: "מחוץ" }));
    expect(rail()).not.toHaveAttribute("data-expanded");
  });

  it("has no collapse toggle — width is not a stored preference any more", () => {
    render(<Sidebar items={items} brand="OrtTube" />);
    expect(screen.queryByRole("button", { name: /סרגל הניווט/ })).toBeNull();
  });
});
