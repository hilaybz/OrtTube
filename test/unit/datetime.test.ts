import { describe, it, expect } from "vitest";
import {
  firstName,
  formatToday,
  greetingFor,
  schoolDayNumber,
} from "@/lib/datetime";

describe("datetime", () => {
  it("greets by the school's clock", () => {
    expect(greetingFor(new Date("2026-08-20T03:00:00.000Z"))).toBe("בוקר טוב");
    expect(greetingFor(new Date("2026-08-20T12:00:00.000Z"))).toBe("צהריים טובים");
    expect(greetingFor(new Date("2026-08-20T17:00:00.000Z"))).toBe("ערב טוב");
    expect(greetingFor(new Date("2026-08-19T22:00:00.000Z"))).toBe("שלום");
  });

  it("greets by first name only, and drops an empty one", () => {
    expect(firstName("דנה כהן לוי")).toBe("דנה");
    expect(firstName("   ")).toBeNull();
    expect(firstName(null)).toBeNull();
  });

  it("counts the day the user lived through, not elapsed hours", () => {
    const late = new Date("2026-08-19T21:30:00.000Z");
    const earlier = new Date("2026-08-19T09:00:00.000Z");
    expect(schoolDayNumber(late) - schoolDayNumber(earlier)).toBe(1);
  });

  it("names the day in school-local time", () => {
    expect(formatToday(new Date("2026-08-25T22:30:00.000Z"))).toContain("26");
  });
});
