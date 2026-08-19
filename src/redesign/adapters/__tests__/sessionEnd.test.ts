// Sub-step 5 — the "Session ends" label is SERVER-TAIPEI + device-clock-free.
// Every helper formats a FIXED instant in a FIXED timezone (Asia/Taipei) via Intl,
// so the runner's own TZ never enters — asserting the exact Taipei output IS the
// proof of tz-independence (a machine in any timezone yields the same value).
import { describe, it, expect } from "vitest";
import { sessionEndLabel, sessionEndInstantMs, taipeiDateOf } from "../sessionEnd";

describe("sessionEnd — server-Taipei, device-clock-free", () => {
  it("taipeiDateOf: a fixed UTC instant → the Taipei calendar date, boundary-correct", () => {
    expect(taipeiDateOf("2026-08-19T20:00:00.000Z")).toBe("2026-08-20"); // +8h crosses into next day
    expect(taipeiDateOf("2026-08-19T15:59:00.000Z")).toBe("2026-08-19"); // 23:59 Taipei — still same day
    expect(taipeiDateOf("2026-08-19T16:00:00.000Z")).toBe("2026-08-20"); // 00:00 Taipei — next day
  });

  it("sessionEndInstantMs: last day = start-Taipei-date + (N-1), 23:59 Taipei == 15:59 UTC", () => {
    const start = "2026-08-19T03:00:00.000Z"; // 11:00 Taipei on 08-19
    expect(sessionEndInstantMs(start, 4)).toBe(Date.UTC(2026, 7, 22, 15, 59, 0)); // 08-22 23:59 Taipei
    expect(sessionEndInstantMs(start, 1)).toBe(Date.UTC(2026, 7, 19, 15, 59, 0)); // 1-day = start day
    // start LATE in the Taipei day still anchors to that Taipei date, not UTC's
    expect(sessionEndInstantMs("2026-08-19T15:30:00.000Z", 2)).toBe(Date.UTC(2026, 7, 20, 15, 59, 0)); // 23:30 Taipei 08-19 → +1 → 08-20
  });

  it("sessionEndLabel: formatted in Asia/Taipei (same on any machine TZ)", () => {
    const label = sessionEndLabel("2026-08-19T03:00:00.000Z", 2, "en"); // end 08-20 23:59 Taipei
    expect(label).toContain("Aug 20");
    expect(label).toMatch(/11:59/);
  });

  it("unknown locale tag falls back to en (never throws); bad start → empty", () => {
    expect(sessionEndLabel("2026-08-19T03:00:00.000Z", 2, "fil")).not.toBe(""); // fil resolves or falls back
    expect(sessionEndLabel("", 2, "en")).toBe("");
    expect(sessionEndLabel("not-a-date", 2, "en")).toBe("");
  });
});
