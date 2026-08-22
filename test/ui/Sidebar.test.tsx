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

  it("marks the active route with aria-current=page (nested match)", () => {
    render(<Sidebar items={items} brand="OrtTube" />);
    expect(screen.getByRole("link", { name: /כיתות/ })).toHaveAttribute("aria-current", "page");
    // Overview is NOT active even though its href is a prefix of "/dashboard/…".
    expect(screen.getByRole("link", { name: /סקירה/ })).not.toHaveAttribute("aria-current");
  });

  it("pins sign-out to the sidebar", () => {
    render(<Sidebar items={items} brand="OrtTube" />);
    expect(screen.getByRole("button", { name: "יציאה" })).toBeInTheDocument();
  });

  it("keeps every nav label in the accessibility tree when collapsed", () => {
    render(<Sidebar items={items} brand="OrtTube" collapsed />);
    // Collapsed hides labels visually only — an icon rail must still be
    // navigable by name.
    expect(screen.getByRole("link", { name: /כיתות/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "יציאה" })).toBeInTheDocument();
  });

  it("exposes a keyboard-operable collapse toggle that reports its state", async () => {
    const onToggleCollapse = vi.fn();
    render(
      <Sidebar items={items} brand="OrtTube" onToggleCollapse={onToggleCollapse} />
    );
    const toggle = screen.getByRole("button", { name: "כיווץ סרגל הניווט" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    toggle.focus();
    await userEvent.keyboard("{Enter}");
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });

  it("labels the toggle by the action it performs when already collapsed", () => {
    render(<Sidebar items={items} brand="OrtTube" collapsed onToggleCollapse={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "הרחבת סרגל הניווט" })
    ).toHaveAttribute("aria-expanded", "false");
  });

  it("omits the toggle entirely when no handler is supplied", () => {
    render(<Sidebar items={items} brand="OrtTube" />);
    expect(screen.queryByRole("button", { name: /סרגל הניווט/ })).toBeNull();
  });
});
