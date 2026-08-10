import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect } from "vitest";

import { PasswordField } from "@/components/ui/PasswordField";
import { Field } from "@/components/ui/Field";

describe("PasswordField", () => {
  it("starts masked and reveals the password when toggled", async () => {
    render(<PasswordField label="סיסמה" name="password" />);
    const input = screen.getByLabelText("סיסמה");
    expect(input).toHaveAttribute("type", "password");

    await userEvent.click(screen.getByRole("button", { name: "הצג סיסמה" }));
    expect(input).toHaveAttribute("type", "text");

    await userEvent.click(screen.getByRole("button", { name: "הסתר סיסמה" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("keeps the typed value across a toggle", async () => {
    render(<PasswordField label="סיסמה" name="password" />);
    const input = screen.getByLabelText("סיסמה");
    await userEvent.type(input, "secret123");

    await userEvent.click(screen.getByRole("button", { name: "הצג סיסמה" }));

    expect(input).toHaveValue("secret123");
  });

  it("uses a non-submitting button so it cannot submit the surrounding form", () => {
    // A bare <button> inside a form defaults to type="submit" — revealing the
    // password would then submit half-filled credentials.
    render(<PasswordField label="סיסמה" name="password" />);
    expect(screen.getByRole("button", { name: "הצג סיסמה" })).toHaveAttribute(
      "type",
      "button"
    );
  });

  it("forwards input attributes through to the underlying field", () => {
    render(
      <PasswordField
        label="סיסמה"
        name="password"
        autoComplete="new-password"
        minLength={6}
        required
      />
    );
    const input = screen.getByLabelText("סיסמה");
    expect(input).toHaveAttribute("autocomplete", "new-password");
    expect(input).toHaveAttribute("minlength", "6");
    expect(input).toBeRequired();
  });
});

describe("Field trailing slot", () => {
  it("renders the trailing control alongside the input", () => {
    render(
      <Field label="שדה" name="f" trailing={<button type="button">פעולה</button>} />
    );
    expect(screen.getByLabelText("שדה")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "פעולה" })).toBeInTheDocument();
  });

  it("still associates label and error when no trailing control is given", () => {
    render(<Field label="שדה" name="f" error="שגיאה" />);
    const input = screen.getByLabelText("שדה");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("שגיאה")).toBeInTheDocument();
  });
});
