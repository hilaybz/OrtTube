import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";

import { IconButton, IconLink } from "@/components/ui/IconButton";
import { BackLink } from "@/components/ui/BackLink";

describe("IconButton", () => {
  it("labels the icon-only button and shows the label as a tooltip on hover", async () => {
    render(<IconButton name="trash" label="מחיקת החידון" />);
    const button = screen.getByRole("button", { name: "מחיקת החידון" });
    expect(button).toHaveAttribute("type", "button");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    await userEvent.hover(button);
    expect(screen.getByRole("tooltip")).toHaveTextContent("מחיקת החידון");
  });

  it("shows the tooltip on keyboard focus too", async () => {
    render(<IconButton name="edit" label="עריכה" />);
    await userEvent.tab();
    expect(screen.getByRole("tooltip")).toHaveTextContent("עריכה");
  });

  it("does not fire while busy", async () => {
    const onClick = vi.fn();
    render(<IconButton name="send" label="שליחה" busy onClick={onClick} />);
    const button = screen.getByRole("button", { name: "שליחה" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");

    await userEvent.click(button, { pointerEventsCheck: 0 });
    expect(onClick).not.toHaveBeenCalled();
  });

  it("IconLink navigates instead of acting", () => {
    render(<IconLink name="chart" label="אנליטיקה" href="/dashboard/analytics" />);
    expect(screen.getByRole("link", { name: "אנליטיקה" })).toHaveAttribute(
      "href",
      "/dashboard/analytics"
    );
  });
});

describe("BackLink", () => {
  it("links to an explicit destination named by the label", () => {
    render(<BackLink href="/dashboard/classes" label="כל הכיתות" />);
    const link = screen.getByRole("link", { name: "כל הכיתות" });
    expect(link).toHaveAttribute("href", "/dashboard/classes");
  });
});
