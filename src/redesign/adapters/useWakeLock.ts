// KEEP-AWAKE habang naka-live (FLive/Chotdon parity) — Screen Wake Lock API,
// WEB-ONLY (walang native plugin, walang includePlugins touch, Vercel-only).
// WHY IT MATTERS: order capture is CLIENT-SIDE — a phone that sleeps mid-live
// stops capturing mines. The lock is held only while capture is actually
// possible/imminent (GREEN or AMBER) and released on an honest GRAY (battery).
//
// Support: Chromium 84+ (Android WebView kasama — ang APK thin shell) at
// WebKit/Safari 16.4+ (ang iOS WKWebView thin shell). iOS <16.4 → walang
// navigator.wakeLock → GRACEFUL NO-OP (feature-detect; zero crash, zero
// behavior change — the phone simply sleeps like today).
//
// Re-acquire semantics: the OS auto-releases the sentinel whenever the page
// hides (app switch / manual screen lock). On visibilitychange back to
// visible we re-request — TRIPLE-GUARDED: (1) page visible (checked in
// acquire), (2) still green/amber + (3) toggle ON — the last two are
// STRUCTURAL: the listener exists only while `hold` is true (the effect
// tears it down the moment the caller's shouldHoldWakeLock turns false).
import { useEffect, useRef } from "react";

interface WakeLockSentinelLike { release: () => Promise<void>; addEventListener: (type: "release", cb: () => void) => void; }
interface WakeLockLike { request: (type: "screen") => Promise<WakeLockSentinelLike>; }
type NavWithWakeLock = Navigator & { wakeLock?: WakeLockLike };

export const wakeLockSupported = (): boolean =>
  typeof navigator !== "undefined" && !!(navigator as NavWithWakeLock).wakeLock;

// PURE — the hold matrix (unit-tested): hold while the seller's toggle is ON
// AND any platform is GREEN (capturing now) or AMBER (connecting/recovering —
// a 60s grace usually self-heals back to green; sleeping mid-heal would kill
// the recovery). Honest GRAY on both platforms → release (no capture, save
// battery).
export interface WakeLockStates {
  ttEff: boolean; fbEff: boolean;                 // green (display truth: connected && !off)
  ttConnecting: boolean; fbConnecting: boolean;   // amber — POST in flight
  ttRecovering: boolean; fbRecovering: boolean;   // amber — F3 grace armed
}
export function shouldHoldWakeLock(enabled: boolean, s: WakeLockStates): boolean {
  if (!enabled) return false;
  return s.ttEff || s.fbEff || s.ttConnecting || s.fbConnecting || s.ttRecovering || s.fbRecovering;
}

export function useWakeLock(hold: boolean): void {
  const sentinelRef = useRef<WakeLockSentinelLike | null>(null);
  useEffect(() => {
    if (!wakeLockSupported()) return; // iOS <16.4 / old engines — graceful no-op
    if (!hold) return;                // gray or toggle OFF — cleanup below already released
    let cancelled = false;
    const acquire = async () => {
      if (cancelled || sentinelRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return; // guard 1
      try {
        const s = await (navigator as NavWithWakeLock).wakeLock!.request("screen");
        if (cancelled) { void s.release().catch(() => {}); return; } // state moved on mid-await
        sentinelRef.current = s;
        // OS-initiated release (page hidden / system policy): forget the dead
        // sentinel so the next visible event can re-acquire.
        s.addEventListener("release", () => { if (sentinelRef.current === s) sentinelRef.current = null; });
      } catch { /* denied (e.g. battery saver) — silent; retried on next visibility */ }
    };
    const onVisibility = () => { if (document.visibilityState === "visible") void acquire(); };
    void acquire();
    document.addEventListener("visibilitychange", onVisibility); // guards 2+3: listener LIVES only while hold=true
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const s = sentinelRef.current;
      sentinelRef.current = null;
      if (s) void s.release().catch(() => {}); // honest gray / toggle OFF / unmount → battery back
    };
  }, [hold]);
}
