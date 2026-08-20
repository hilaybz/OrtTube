import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

import { SignInForm } from "@/app/(auth)/sign-in/SignInForm";

describe("SignInForm", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
  });

  it("navigates to the server-returned route on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ route: "/dashboard", role: "teacher" }),
      }))
    );
    render(<SignInForm />);
    await userEvent.type(screen.getByLabelText("אימייל"), "t@example.com");
    await userEvent.type(screen.getByLabelText("סיסמה"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: "התחברות" }));
    expect(push).toHaveBeenCalledWith("/dashboard");
  });

  it("offers no self-signup path — accounts are provisioned by the school", () => {
    render(<SignInForm />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("shows the Hebrew message for a bad-credentials envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: { code: "invalid_credentials" } }),
      }))
    );
    render(<SignInForm />);
    await userEvent.type(screen.getByLabelText("אימייל"), "t@example.com");
    await userEvent.type(screen.getByLabelText("סיסמה"), "bad");
    await userEvent.click(screen.getByRole("button", { name: "התחברות" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("שגוי");
    expect(push).not.toHaveBeenCalled();
  });
});
