import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { Sidebar } from "@/components/shell/Sidebar";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/classes" }));

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
});
