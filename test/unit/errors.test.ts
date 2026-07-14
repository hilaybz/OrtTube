import { describe, it, expect } from "vitest";
import { messageForCode } from "@/lib/errors";

describe("messageForCode", () => {
  it("maps known codes to Hebrew", () => {
    expect(messageForCode("no_attempts_left")).toContain("ניסיונות");
    expect(messageForCode("invalid_credentials")).toContain("שגוי");
  });
  it("falls back for unknown codes", () => {
    expect(messageForCode("weird_code")).toBe("אירעה שגיאה. נסו שוב.");
  });
  it("falls back for undefined", () => {
    expect(messageForCode(undefined)).toBe("אירעה שגיאה. נסו שוב.");
  });
});
