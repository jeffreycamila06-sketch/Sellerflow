// Native update logic — version comparison, capability-synthesized build,
// dismiss-once-per-session, store URLs, slide-threshold math, message-key
// whitelist. Pure functions (no DOM) plus the sessionStorage dismissal.
import { describe, it, expect, beforeEach } from "vitest";
import {
  isStale, readBinaryBuild, shouldShowUpdate, storeUrlFor,
  resolveMessageKey, IOS_BLE_BUILD,
  dismissKey, wasDismissed, markDismissed,
} from "../nativeVersion";

describe("nativeVersion — version comparison", () => {
  it("isStale respects the dormant (latest<=0) off-switch", () => {
    expect(isStale(0, 0)).toBe(false);     // dormant → nobody nagged
    expect(isStale(0, 6)).toBe(true);      // legacy build below latest
    expect(isStale(6, 6)).toBe(false);     // current
    expect(isStale(7, 6)).toBe(false);     // ahead
    expect(isStale(Number.POSITIVE_INFINITY, 6)).toBe(false); // unknown android → never
  });

  it("readBinaryBuild: real bridge integer wins", () => {
    expect(readBinaryBuild("ios", { bridgeBuild: 9, hasBle: false })).toBe(9);
    expect(readBinaryBuild("android", { bridgeBuild: 4 })).toBe(4);
  });

  it("readBinaryBuild: iOS capability synthesis (BLE ⇒ 1.2 build, else legacy 0)", () => {
    expect(readBinaryBuild("ios", { hasBle: true })).toBe(IOS_BLE_BUILD);
    expect(readBinaryBuild("ios", { hasBle: false })).toBe(0);
    expect(readBinaryBuild("ios", {})).toBe(0);
  });

  it("readBinaryBuild: Android without a bridge is fail-safe (Infinity → never stale)", () => {
    expect(readBinaryBuild("android", {})).toBe(Number.POSITIVE_INFINITY);
  });

  it("shouldShowUpdate: stale + not dismissed → show; dismissed → hide; force overrides dismissal", () => {
    const cfg = { latest: 6, message_key: "rd_upd_msg_ble", force: false };
    expect(shouldShowUpdate(cfg, 0, false)).toBe(true);
    expect(shouldShowUpdate(cfg, 0, true)).toBe(false);
    expect(shouldShowUpdate({ ...cfg, force: true }, 0, true)).toBe(true);
    expect(shouldShowUpdate({ latest: 0, message_key: "x", force: false }, 0, false)).toBe(false); // dormant
    expect(shouldShowUpdate(undefined, 0, false)).toBe(false);
    expect(shouldShowUpdate(cfg, 6, false)).toBe(false); // current build
  });
});

describe("nativeVersion — store URLs", () => {
  it("iOS uses the App Store id, Android uses the package id", () => {
    expect(storeUrlFor("ios").app).toContain("id6783770354");
    expect(storeUrlFor("ios").web).toBe("https://apps.apple.com/app/id6783770354");
    expect(storeUrlFor("android").app).toBe("market://details?id=com.sellerflow.live");
    expect(storeUrlFor("android").web).toContain("id=com.sellerflow.live");
  });
});

describe("nativeVersion — message-key whitelist", () => {
  it("returns known keys and falls back to generic for unknown/missing", () => {
    expect(resolveMessageKey("rd_upd_msg_ble")).toBe("rd_upd_msg_ble");
    expect(resolveMessageKey("rd_upd_msg_generic")).toBe("rd_upd_msg_generic");
    expect(resolveMessageKey("rd_upd_msg_totally_made_up")).toBe("rd_upd_msg_generic");
    expect(resolveMessageKey(undefined)).toBe("rd_upd_msg_generic");
  });
});

describe("nativeVersion — dismiss once per session (keyed by target build)", () => {
  beforeEach(() => { try { sessionStorage.clear(); } catch { /* */ } });
  it("marks + reads dismissal, scoped per platform+latest", () => {
    expect(wasDismissed("ios", 6)).toBe(false);
    markDismissed("ios", 6);
    expect(wasDismissed("ios", 6)).toBe(true);
    expect(wasDismissed("ios", 7)).toBe(false); // a new release re-prompts
    expect(wasDismissed("android", 6)).toBe(false);
    expect(dismissKey("ios", 6)).toBe("sfl_upd_seen_ios_6");
  });
});
