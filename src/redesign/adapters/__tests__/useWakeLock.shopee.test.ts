// Keep-awake during a Shopee-only live (2026-11-22). Before: shouldHoldWakeLock looked at TikTok,
// Facebook and Instagram only, so the screen could lock during a Shopee live and the paused app
// missed orders. Now the Shopee reader being green, or the paste-box connect being under way,
// keeps the screen on too. TikTok / Facebook / Instagram: exactly the old answer.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { shouldHoldWakeLock, type WakeLockStates } from "../useWakeLock";

const GRAY: WakeLockStates = { ttEff: false, fbEff: false, ttConnecting: false, fbConnecting: false, ttRecovering: false, fbRecovering: false };
const SIX = ["ttEff", "fbEff", "ttConnecting", "fbConnecting", "ttRecovering", "fbRecovering"] as const;
// main's rule, word for word (main 360ce26c, useWakeLock.ts:37-40)
const mainRule = (enabled: boolean, s: WakeLockStates) => {
  if (!enabled) return false;
  return s.ttEff || s.fbEff || s.ttConnecting || s.fbConnecting || s.ttRecovering || s.fbRecovering;
};

describe("shouldHoldWakeLock — Shopee", () => {
  it("Shopee green → hold; Shopee connecting → hold", () => {
    expect(shouldHoldWakeLock(true, { ...GRAY, shEff: true })).toBe(true);
    expect(shouldHoldWakeLock(true, { ...GRAY, shConnecting: true })).toBe(true);
  });
  it("Shopee gray (or not given) → no hold from Shopee", () => {
    expect(shouldHoldWakeLock(true, { ...GRAY, shEff: false, shConnecting: false })).toBe(false);
    expect(shouldHoldWakeLock(true, GRAY)).toBe(false);
  });
  it("the keep-awake switch OFF → never hold, even with Shopee green", () => {
    expect(shouldHoldWakeLock(false, { ...GRAY, shEff: true, shConnecting: true })).toBe(false);
  });
  it("TikTok / Facebook / Instagram unchanged: all 64 combinations × switch on/off = main's answer", () => {
    let n = 0;
    for (let bits = 0; bits < 64; bits++) {
      const s = { ...GRAY } as WakeLockStates;
      SIX.forEach((k, i) => { s[k] = (bits & (1 << i)) !== 0; });
      for (const on of [true, false]) {
        expect(shouldHoldWakeLock(on, s)).toBe(mainRule(on, s));                                    // Shopee absent
        expect(shouldHoldWakeLock(on, { ...s, shEff: false, shConnecting: false })).toBe(mainRule(on, s)); // Shopee gray
        n += 2;
      }
    }
    expect(n).toBe(256);
  });
});

describe("RedesignApp — the keep-awake call", () => {
  const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  const call = src.slice(src.indexOf("useWakeLock(shouldHoldWakeLock(keepAwake, {"), src.indexOf("}));", src.indexOf("useWakeLock(shouldHoldWakeLock(keepAwake, {")) + 4);
  it("passes Shopee green + connecting; the TikTok / Facebook / Instagram lines are main's", () => {
    expect(call).toContain("ttEff, fbEff: fbEff || igEff, // a live Instagram keeps the screen on too (igEff false without IG)");
    expect(call).toContain("ttConnecting, fbConnecting: fbConnecting || igConnecting,");
    expect(call).toContain("ttRecovering: liveFeed.ttRecovering, fbRecovering: liveFeed.fbRecovering,");
    expect(call).toMatch(/shEff: shopeeEff, shConnecting: shopee(Connecting|Busy),/);
  });
});
