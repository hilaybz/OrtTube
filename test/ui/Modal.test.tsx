import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { Modal } from "@/components/ui/Modal";

describe("Modal", () => {
  it("renders as a dialog and closes on Escape", async () => {
    const onClose = vi.fn();
    render(
      <Modal open title="שאל/י את המורה" onClose={onClose}>
        <p>תוכן</p>
      </Modal>
    );
    expect(screen.getByRole("dialog", { name: "שאל/י את המורה" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <Modal open={false} title="x" onClose={() => {}}>
        y
      </Modal>
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
