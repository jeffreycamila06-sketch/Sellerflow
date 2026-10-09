// Session V2 owner gate — the email allowlist that turns on the "Start/End Session"
// (5-day) UX for the owner ONLY. Every other account → false → the existing picker
// path is untouched. Instant revert = empty SESSION_V2_EMAILS.
import { describe, it, expect } from "vitest";
import { sessionV2Enabled, SESSION_V2_DAYS } from "../sessionV2";
import { setFeatureAccess } from "../featureAccess";
import { seedEmails } from "./featureSeed";

describe("sessionV2Enabled", () => {
  it("signed-in user with the session_v2 flag → true", () => {
    setFeatureAccess({ session_v2: true });
    expect(sessionV2Enabled("camilajeffrey1@gmail.com")).toBe(true);
    setFeatureAccess(null);
  });
  it("without the flag → false (byte-for-byte unchanged path)", () => {
    setFeatureAccess(null);
    for (const e of ["camilajeffrey1@gmail.com", "someone@else.com", "", null, undefined])
      expect(sessionV2Enabled(e)).toBe(false);
  });
  it("the database list is exactly the owner + 7-day fixed length", () => {
    expect(seedEmails("session_v2")).toEqual(["camilajeffrey1@gmail.com"]);
    expect(SESSION_V2_DAYS).toBe(7);
  });
});
