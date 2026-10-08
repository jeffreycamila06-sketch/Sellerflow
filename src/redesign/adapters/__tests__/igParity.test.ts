// INSTAGRAM phase 1 — every shared function that learned "Instagram" is compared with a
// VERBATIM copy of today's version (origin/main 957d960) for every TikTok / Facebook / Shopee /
// legacy input: identical output. Only an "Instagram" value reaches the new branches.
// Also covers the Session-RPC v2 follow-up (b): the in-app fallback sees a live Facebook /
// Instagram, while a TikTok-only seller stays byte-identical.
import { describe, it, expect } from "vitest";
import { fbNameOnly } from "../fbName";
import { stickerQrAllowedFor } from "../printing";
import { parseCoverage } from "../accountLive";
import { livePickerView, type PickerPlatform } from "../livePicker";
import { livePlatformOf, connectIsSwitch, type SourcePlatform } from "../liveSource";

// ── verbatim copies (before Instagram) ──────────────────────────────────────
const FB_UNKNOWN_NAME = "Unknown";
const isFacebookPlatformBefore = (p: string | null | undefined) => String(p ?? "").trim().toLowerCase() === "facebook";
function fbNameOnlyBefore(platform: string | null | undefined, name: string | null | undefined): boolean {
  if (!isFacebookPlatformBefore(platform)) return false;
  const n = String(name ?? "").trim();
  return n !== "" && n !== FB_UNKNOWN_NAME;
}
function stickerQrAllowedForBefore(platform: string | undefined | null): boolean {
  return String(platform ?? "").trim().toLowerCase() !== "facebook";
}
type Flags = { connected: boolean; connecting: boolean };
function livePickerViewBefore(o: { enabled: boolean; tt: Flags; fb: Flags; sh: Flags; hasComments: boolean; chosen: PickerPlatform | null }) {
  if (!o.enabled) return { view: "classic" };
  const active = ([["TikTok", o.tt], ["Facebook", o.fb], ["Shopee", o.sh]] as const).filter(([, f]) => f.connected || f.connecting);
  if (active.length > 1) return { view: "classic" };
  const idle = o.hasComments ? { view: "body" as const } : { view: "picker" as const };
  if (active.length === 1) {
    const [platform, f] = active[0];
    if (!f.connected && o.chosen === platform) return idle;
    return { view: "connected", platform };
  }
  return idle;
}
function livePlatformOfBefore(f: { ttEff: boolean; shopeeEff: boolean }): SourcePlatform | null {
  if (f.ttEff) return "TikTok";
  if (f.shopeeEff) return "Shopee";
  return null;
}
const isPlatformSwitchBefore = (live: SourcePlatform | null, next: SourcePlatform) => live !== null && live !== next;
const isServerPlatformSwitchBefore = (s: string | null | undefined, next: SourcePlatform) => !!s && s !== next;
function connectIsSwitchBefore(server: string | null | undefined, next: SourcePlatform, f: { ttEff: boolean; shopeeEff: boolean }) {
  return server ? isServerPlatformSwitchBefore(server, next) : isPlatformSwitchBefore(livePlatformOfBefore(f), next);
}

const OLD_PLATFORMS = ["TikTok", "tiktok", "Facebook", "facebook", " FACEBOOK ", "Shopee", "", undefined, null];
const NAMES = ["Caren Kay", "buyer1", "Unknown", "", " ", undefined, null, "陳小美"];

describe("name-once rule + sticker QR: identical for every non-Instagram platform", () => {
  it("fbNameOnly", () => {
    for (const p of OLD_PLATFORMS) for (const n of NAMES) expect(fbNameOnly(p, n)).toBe(fbNameOnlyBefore(p, n));
  });
  it("stickerQrAllowedFor", () => {
    for (const p of OLD_PLATFORMS) expect(stickerQrAllowedFor(p)).toBe(stickerQrAllowedForBefore(p));
  });
  it("Instagram: username printed once, no QR (owner decision 3)", () => {
    for (const p of ["Instagram", "instagram", " INSTAGRAM "]) {
      expect(fbNameOnly(p, "buyer1")).toBe(true);
      expect(stickerQrAllowedFor(p)).toBe(false);
    }
    expect(fbNameOnly("Instagram", "Unknown")).toBe(false); // the same no-name guard as Facebook
  });
});

describe("parseCoverage: identical for TikTok / Facebook / Shopee, now keeps Instagram", () => {
  const raw = { enforce: true, limit: 2, unlimited: false, total: 4, accounts: [
    { platform: "tiktok", key: "a", rank: 1, covered: true }, { platform: "facebook", key: "P", rank: 2, covered: true },
    { platform: "shopee", key: "9", rank: 3, covered: false }, { platform: "instagram", key: "178", rank: 4, covered: false },
    { platform: "other", key: "z", rank: 5, covered: false },
  ] };
  it("the three existing platforms come out exactly as before; unknown still dropped", () => {
    const c = parseCoverage(raw)!;
    expect(c.accounts.filter((a) => a.platform !== "instagram")).toEqual([
      { platform: "tiktok", key: "a", rank: 1, covered: true }, { platform: "facebook", key: "P", rank: 2, covered: true }, { platform: "shopee", key: "9", rank: 3, covered: false },
    ]);
    expect(c.accounts.find((a) => a.platform === "instagram")).toEqual({ platform: "instagram", key: "178", rank: 4, covered: false });
  });
});

describe("livePickerView: identical whenever Instagram is absent or idle", () => {
  const F = [{ connected: false, connecting: false }, { connected: true, connecting: false }, { connected: false, connecting: true }];
  const chosenList: (PickerPlatform | null)[] = [null, "TikTok", "Facebook", "Shopee", "Instagram"];
  it("every combination", () => {
    for (const enabled of [false, true]) for (const tt of F) for (const fb of F) for (const sh of F) for (const hasComments of [false, true]) for (const chosen of chosenList) {
      const before = livePickerViewBefore({ enabled, tt, fb, sh, hasComments, chosen });
      expect(livePickerView({ enabled, tt, fb, sh, hasComments, chosen })).toEqual(before);
      expect(livePickerView({ enabled, tt, fb, sh, ig: F[0], hasComments, chosen })).toEqual(before);
    }
  });
  it("a live Instagram alone → the connected view for Instagram; with another live source → classic", () => {
    const off = F[0];
    expect(livePickerView({ enabled: true, tt: off, fb: off, sh: off, ig: F[1], hasComments: false, chosen: null })).toEqual({ view: "connected", platform: "Instagram" });
    expect(livePickerView({ enabled: true, tt: F[1], fb: off, sh: off, ig: F[1], hasComments: false, chosen: null })).toEqual({ view: "classic" });
  });
});

describe("Session-RPC v2 follow-up (b) — the in-app fallback", () => {
  const targets: SourcePlatform[] = ["TikTok", "Facebook", "Shopee", "Instagram"];
  it("TikTok-only seller (no Facebook / Instagram live): identical to before in every input", () => {
    for (const server of ["TikTok", "Facebook", "Shopee", "Instagram", null, undefined, ""]) for (const ttEff of [true, false]) for (const shopeeEff of [true, false]) for (const next of targets) {
      const before = connectIsSwitchBefore(server, next, { ttEff, shopeeEff });
      expect(connectIsSwitch(server, next, { ttEff, shopeeEff })).toBe(before);
      expect(connectIsSwitch(server, next, { ttEff, shopeeEff, fbEff: false, igEff: false })).toBe(before);
      expect(livePlatformOf({ ttEff, shopeeEff, fbEff: false, igEff: false })).toBe(livePlatformOfBefore({ ttEff, shopeeEff }));
    }
  });
  it("unknown server platform + a live Facebook → a TikTok / Instagram connect is a switch", () => {
    expect(connectIsSwitch(null, "TikTok", { ttEff: false, shopeeEff: false, fbEff: true })).toBe(true);
    expect(connectIsSwitch(null, "Instagram", { ttEff: false, shopeeEff: false, fbEff: true })).toBe(true);
    expect(connectIsSwitch(null, "Facebook", { ttEff: false, shopeeEff: false, fbEff: true })).toBe(false);
    expect(connectIsSwitchBefore(null, "TikTok", { ttEff: false, shopeeEff: false })).toBe(false); // before: missed
  });
  it("unknown server platform + a live Instagram → a TikTok connect is a switch; Instagram continues", () => {
    expect(connectIsSwitch(undefined, "TikTok", { ttEff: false, shopeeEff: false, igEff: true })).toBe(true);
    expect(connectIsSwitch(undefined, "Instagram", { ttEff: false, shopeeEff: false, igEff: true })).toBe(false);
  });
  it("TikTok and Shopee keep priority over Facebook / Instagram in the in-app check", () => {
    expect(livePlatformOf({ ttEff: true, shopeeEff: false, fbEff: true, igEff: true })).toBe("TikTok");
    expect(livePlatformOf({ ttEff: false, shopeeEff: true, fbEff: true, igEff: true })).toBe("Shopee");
    expect(livePlatformOf({ ttEff: false, shopeeEff: false, fbEff: true, igEff: true })).toBe("Facebook");
  });
  it("a known server platform still decides, whatever the flags say", () => {
    expect(connectIsSwitch("Instagram", "Instagram", { ttEff: true, shopeeEff: true, fbEff: true, igEff: false })).toBe(false);
    expect(connectIsSwitch("TikTok", "Instagram", { ttEff: false, shopeeEff: false, igEff: true })).toBe(true);
  });
});
