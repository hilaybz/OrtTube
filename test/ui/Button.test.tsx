import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { Button } from "@/components/ui/Button";

describe("Button", () => {
  it("fires onClick and is a real <button>", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>שליחה</Button>);
    await userEvent.click(screen.getByRole("button", { name: "שליחה" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not fire when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        שליחה
      </Button>
    );
    await userEvent.click(screen.getByRole("button", { name: "שליחה" })).catch(() => {});
    expect(onClick).not.toHaveBeenCalled();
  });

  it("defaults to type=button (won't submit forms)", () => {
    render(<Button>שליחה</Button>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });
});
