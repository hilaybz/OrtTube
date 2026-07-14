import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Field } from "@/components/ui/Field";

describe("Field", () => {
  it("associates label with input via id/htmlFor", () => {
    render(<Field label="אימייל" name="email" type="email" />);
    const input = screen.getByLabelText("אימייל");
    expect(input).toHaveAttribute("type", "email");
    expect(input).toHaveAttribute("name", "email");
  });

  it("wires aria-invalid and the error message when errored", () => {
    render(<Field label="אימייל" name="email" error="כתובת לא תקינה" />);
    const input = screen.getByLabelText("אימייל");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("כתובת לא תקינה")).toBeInTheDocument();
  });
});
