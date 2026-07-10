// Native "time for an update" logic (pure + a few thin runtime probes). Thin-shell
// model: web features arrive instantly via the production bundle, but NATIVE
// changes (BLE printing, plugins) need a store update, and some users lag on an
// old binary (the 1.0/1.1 → 1.2 BLE transition). This compares the running
// binary's build number against a web-served source of truth
// (public/native-version.json) and drives a one-per-open update modal.
//
// ZERO new network beyond ONE same-origin static fetch of the JSON per cold open.
// The modal is NATIVE-only (web browsers never see it) — see currentNativePlatform.
//
// ⚠️ Build-number detection reality: there is no @capacitor/app / getInfo bridge,
// and already-shipped OLD binaries carry no version bridge at all. So we SYNTHESIZE
// the build from a native CAPABILITY that the newest binary added: the iOS BLE
// sticker methods (window.SellerFlowPrinter.scanBluetoothLabelPrinters), present
// only in the 1.2 (Build 6) binary. This is pure web, needs no native code, and
// works on the binaries already in users' hands. A future optional
// window.SellerFlowPrinter.getBuildNumber() bridge (added to the next binary) is
// preferred when present, making later comparisons exact integers.

export type NativePlatform = "ios" | "android";

export interface PlatformVersion {
  latest: number;        // newest build/versionCode integer (iOS buildNumber / Android versionCode)
  message_key: string;   // i18n key for the modal body (whitelisted below)
  force: boolean;        // true = no dismiss (emergency; default false)
}
export interface NativeVersionConfig {
  ios: PlatformVersion;
  android: PlatformVersion;
}

// The iOS 1.2 binary (Build 6) added the BLE sticker bridge; older binaries lack
// it. When we can't read a real integer, iOS with BLE ⇒ this build, without ⇒ 0.
export const IOS_BLE_BUILD = 6;

// Whitelisted message keys — the JSON's message_key is looked up against this set
// (config-driven, NOT constructed at runtime), falling back to the generic key so
// a stale/typo'd key can never render blank. Every key here is defined ×7 langs.
export const UPDATE_MESSAGE_KEYS = ["rd_upd_msg_ble", "rd_upd_msg_generic"] as const;
export function resolveMessageKey(key: string | undefined): string {
  return key && (UPDATE_MESSAGE_KEYS as readonly string[]).includes(key) ? key : "rd_upd_msg_generic";
}

// ── pure logic ───────────────────────────────────────────────────────────────

// A platform is "off" when latest <= 0 (dormant default; nobody is nagged until a
// release bumps it). Otherwise stale iff the running build is a finite number below.
export function isStale(build: number, latest: number): boolean {
  return latest > 0 && Number.isFinite(build) && build < latest;
}

// Resolve the running binary's build number.
//  1. real integer from an (optional, future) native getBuildNumber bridge, else
//  2. capability synthesis: iOS → BLE present ? IOS_BLE_BUILD : 0 (legacy 1.0/1.1),
//     Android → Infinity (no capability gap today → fail-safe, never stale).
export function readBinaryBuild(
  platform: NativePlatform,
  signals: { bridgeBuild?: number | null; hasBle?: boolean },
): number {
  const b = signals.bridgeBuild;
  if (typeof b === "number" && Number.isFinite(b)) return b;
  if (platform === "ios") return signals.hasBle ? IOS_BLE_BUILD : 0;
  return Number.POSITIVE_INFINITY;
}

export function shouldShowUpdate(cfg: PlatformVersion | undefined, build: number, dismissed: boolean): boolean {
  if (!cfg) return false;
  if (!isStale(build, cfg.latest)) return false;
  if (cfg.force) return true;
  return !dismissed;
}

// Store deep-link (app scheme) + web fallback per platform.
export function storeUrlFor(platform: NativePlatform): { app: string; web: string } {
  if (platform === "ios") {
    return { app: "itms-apps://apps.apple.com/app/id6783770354", web: "https://apps.apple.com/app/id6783770354" };
  }
  return { app: "market://details?id=com.sellerflow.live", web: "https://play.google.com/store/apps/details?id=com.sellerflow.live" };
}

// ── runtime probes (guarded; not the unit-test surface) ────────────────────────

// The real native platform. Web browsers (no Capacitor) → null → modal never shows.
export function currentNativePlatform(): NativePlatform | null {
  if (typeof window === "undefined") return null;
  try {
    const p = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
    return p === "ios" || p === "android" ? p : null;
  } catch {
    return null;
  }
}

// Optional future exact-version bridge; absent on every binary today → null.
export function bridgeBuildNumber(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const fn = (window as unknown as { SellerFlowPrinter?: { getBuildNumber?: () => number | string } }).SellerFlowPrinter?.getBuildNumber;
    if (typeof fn !== "function") return null;
    const n = Number(fn());
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// Dev/preview-only force toggle so Jeff can see the modal in a plain browser
// (?preview_update=1) WITHOUT an old binary. Gated to non-production hosts so it
// can never force-show for real production web users.
export function isUpdatePreview(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (!new URLSearchParams(window.location.search).has("preview_update")) return false;
    const dev = (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV;
    if (dev) return true;
    const h = window.location.hostname;
    return h !== "www.sellerflowlive.com" && h !== "sellerflowlive.com";
  } catch {
    return false;
  }
}

// Dismiss-once-per-open, keyed by target build so a new release re-prompts.
// sessionStorage survives in-app navigation/reloads, clears on WebView destroy
// (full close) → the next cold open re-checks while still stale.
export function dismissKey(platform: NativePlatform, latest: number): string {
  return `sfl_upd_seen_${platform}_${latest}`;
}
export function wasDismissed(platform: NativePlatform, latest: number): boolean {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage.getItem(dismissKey(platform, latest)) === "1";
  } catch {
    return false;
  }
}
export function markDismissed(platform: NativePlatform, latest: number): void {
  try {
    sessionStorage.setItem(dismissKey(platform, latest), "1");
  } catch {
    /* private mode / unavailable — dismissal just won't persist within the session */
  }
}
