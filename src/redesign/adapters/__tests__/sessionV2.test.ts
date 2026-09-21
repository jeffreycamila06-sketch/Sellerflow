// Session V2 owner gate — the email allowlist that turns on the "Start/End Session"
// (5-day) UX for the owner ONLY. Every other account → false → the existing picker
// path is untouched. Instant revert = empty SESSION_V2_EMAILS.
import { describe, it, expect } from "vitest";
import { sessionV2Enabled, SESSION_V2_EMAILS, SESSION_V2_DAYS } from "../sessionV2";

describe("sessionV2Enabled", () => {
  it("the owner email → true (case-insensitive, trimmed)", () => {
    expect(sessionV2Enabled("camilajeffrey1@gmail.com")).toBe(true);
    expect(sessionV2Enabled("  Camilajeffrey1@GMAIL.com ")).toBe(true);
  });
  it("every other account → false (byte-for-byte unchanged path)", () => {
    for (const e of ["googletest@gmail.com", "someone@else.com", "", null, undefined])
      expect(sessionV2Enabled(e)).toBe(false);
  });
  it("the allowlist is exactly the owner + 7-day fixed length", () => {
    expect(SESSION_V2_EMAILS).toEqual(["camilajeffrey1@gmail.com"]);
    expect(SESSION_V2_DAYS).toBe(7);
  });
});
