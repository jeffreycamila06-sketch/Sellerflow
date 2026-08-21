// Pure cooldown helpers — the SERVER-TIME lock decision and countdown formatting.
// Every case uses an explicit serverNowMs (never Date.now()) to prove the decision is
// server-anchored.
import { describe, it, expect } from "vitest";
import { slotLockState, unlockInHM, windowClock, COOLDOWN_MS, WINDOW_MS, slotKey } from "../tiktokCooldown";

const H = 60 * 60 * 1000;

describe("slotLockState — server-time 4h decision", () => {
  it("no row → unlocked (a saved slot never changed is editable)", () => {
    expect(slotLockState(null, 1_000_000)).toEqual({ status: "unlocked", unlockAtMs: null });
  });
  it("<4h since change → cooling, unlockAt = lastChanged + 4h", () => {
    const last = 1_000_000;
    const st = slotLockState(last, last + 3 * H); // 3h elapsed
    expect(st.status).toBe("cooling");
    expect(st.unlockAtMs).toBe(last + COOLDOWN_MS);
  });
  it("exactly 4h → unlocked (boundary)", () => {
    const last = 5_000_000;
    expect(slotLockState(last, last + COOLDOWN_MS)).toEqual({ status: "unlocked", unlockAtMs: null });
  });
  it(">4h → unlocked", () => {
    const last = 5_000_000;
    expect(slotLockState(last, last + 10 * H).status).toBe("unlocked");
  });
  it("COOLDOWN_MS is 4 hours, WINDOW_MS is 5 minutes", () => {
    expect(COOLDOWN_MS).toBe(4 * 60 * 60 * 1000);
    expect(WINDOW_MS).toBe(5 * 60 * 1000);
  });
});

describe("unlockInHM — minutes rounded up, never 0h0m while cooling", () => {
  it("3h 12m remaining", () => { expect(unlockInHM(3 * H + 12 * 60 * 1000)).toEqual({ h: 3, m: 12 }); });
  it("rounds partial minute UP (3h59m30s → 4h 0m)", () => { expect(unlockInHM(3 * H + 59 * 60 * 1000 + 30_000)).toEqual({ h: 4, m: 0 }); });
  it("1 second left → 1m (never shows 0)", () => { expect(unlockInHM(1000)).toEqual({ h: 0, m: 1 }); });
  it("negative clamps to 0h 0m", () => { expect(unlockInHM(-5000)).toEqual({ h: 0, m: 0 }); });
});

describe("windowClock — M:SS", () => {
  it("5:00 / 0:09 / 0:00", () => {
    expect(windowClock(WINDOW_MS)).toBe("5:00");
    expect(windowClock(9000)).toBe("0:09");
    expect(windowClock(0)).toBe("0:00");
    expect(windowClock(-100)).toBe("0:00");
  });
});

describe("slotKey", () => {
  it("platform:index", () => { expect(slotKey("tiktok", 2)).toBe("tiktok:2"); });
});
