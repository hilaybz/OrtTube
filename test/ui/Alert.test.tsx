import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Alert } from "@/components/ui/Alert";

describe("Alert", () => {
  it("uses role=alert for danger", () => {
    render(<Alert variant="danger">שגיאה</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent("שגיאה");
  });

  it("uses role=status for informational variants", () => {
    render(<Alert variant="brand">מידע</Alert>);
    expect(screen.getByRole("status")).toHaveTextContent("מידע");
  });
});
